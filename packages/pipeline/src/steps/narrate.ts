import { NotFoundError, QUEUES, ValidationError, newId, sha256 } from "@imovel/core";
import { narrate, normalizeForSpeech } from "@imovel/tts";
import { recordTtsUsage } from "@imovel/observability";
import type { NarratePayload, NextAction, PipelineDeps } from "../deps";
import { loadJobAndListing } from "./generate";
import { moveJob, recordStep } from "../stepRecorder";

/** Step ③: the gated `narracao` becomes audio. Cached when text and voice are unchanged. */
export async function narrateStep(deps: PipelineDeps, payload: NarratePayload): Promise<NextAction> {
  const { job: initial } = await loadJobAndListing(deps, payload.job_id);
  const generation = await deps.repos.generations.get(payload.generation_id);
  if (!generation) throw new NotFoundError(`Generation ${payload.generation_id} not found`);
  const job = await moveJob(deps, initial, "narrating", { current_step: "narrate" });

  const profile = await deps.repos.profiles.getVoice(job.tenant_id, job.voice_profile_id);
  if (!profile) throw new ValidationError("No voice profile for this job");

  const normalizedPreview = normalizeForSpeech(generation.result.narracao, { glossary: profile.glossary }).text;
  const textHash = sha256(normalizedPreview);
  const cached = await deps.repos.ttsCache.get(textHash, profile.id);
  if (cached) {
    const existing = await deps.repos.narrations.get(cached);
    if (existing) {
      deps.logger.info({ job_id: job.id, narration_id: existing.id }, "narration served from tts cache");
      await moveJob(deps, job, "narrated");
      return { queue: QUEUES.publish, payload: { job_id: job.id, generation_id: generation.id, narration_id: existing.id, warnings: ["narration reused from cache"] } };
    }
  }

  const narrationId = newId();
  const { narration, warnings } = await recordStep(deps, job, "narrate", job.loop * 10 + 1, async () => {
    const out = await narrate({
      text: generation.result.narracao,
      profile,
      provider: deps.tts,
      store: deps.store,
      keyPrefix: `${job.tenant_id}/listings/${job.listing_id}/jobs/${job.id}/narration`,
      ids: { narration_id: narrationId, job_id: job.id, generation_id: generation.id },
      ffmpeg: { enabled: deps.ffmpeg.enabled },
      accentJudge: deps.accentJudge,
      now: deps.now,
    });
    const cost = await recordTtsUsage(deps.ledger, {
      tenant_id: job.tenant_id,
      job_id: job.id,
      step: "narrate",
      provider: deps.tts.id,
      usage: { chars: out.narration.usage.chars, gpu_seconds: out.narration.usage.gpu_seconds, audio_seconds: out.narration.duration_s },
    });
    return { result: out, output_ref: out.narration.wav_key, usage: { chars: out.narration.usage.chars, duration_s: out.narration.duration_s }, cost_usd: cost.cost_usd, input_hash: textHash };
  });

  await deps.repos.narrations.save(narration);
  await deps.repos.ttsCache.set(narration.text_hash, profile.id, narration.id);
  await moveJob(deps, job, "narrated");
  return { queue: QUEUES.publish, payload: { job_id: job.id, generation_id: generation.id, narration_id: narration.id, warnings } };
}
