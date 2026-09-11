# VoxCPM2 on RunPod Serverless

VoxCPM2 narrates the gated `narracao` field in a cloned pt-PT voice. It runs as a RunPod
Serverless worker (`handler.py`) so the pipeline pays per second of GPU time and scales to
zero between listings.

## Model facts (verified September 2026)

- `pip install voxcpm`; `openbmb/VoxCPM2`, 2B params, Apache-2.0, 30 languages including
  "Portuguese" with **no pt-PT/pt-BR distinction** — the accent has to come from a cloned
  European Portuguese reference voice, not from a language/locale flag.
- `VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)`, then
  `model.generate(text=..., reference_wav_path=..., prompt_wav_path=..., prompt_text=...,
  cfg_value=2.0, inference_timesteps=10, seed=42)` returns a float array at
  `model.tts_model.sample_rate` (48 kHz). The reference clip may itself be 16 kHz.
- Style (tone, pace, accent framing) is controlled by a parenthesised instruction at the
  start of the text, e.g. `"(voz adulta, tom profissional, sotaque de Lisboa)Olá."` — the
  `packages/tts` adapter prepends the voice profile's `style_prompt` before sending text here.
- ~8 GB VRAM for the plain library call this worker makes (RTF ≈ 0.30); vLLM-Omni batches at
  RTF ≈ 0.12 but needs ≥ 24 GB VRAM kept warm (see `serve-omni.sh` below).
- VoxCPM2's policy forbids impersonation and asks for labelling: every `NarrationResult` this
  pipeline produces sets `ai_generated: true`, and a `VoiceProfile` needs a signed
  `consent_doc_ref` before `packages/tts` will use a `voxcpm2-*` provider with it
  (`narrate()` throws `ValidationError` otherwise).

## Deploy

1. RunPod console → Serverless → New Endpoint → **Docker image** (this handler is not one of
   the quick-deploy templates), pointing at an image built from this directory's `Dockerfile`.
2. GPU: **24 GB tier** (L4 $0.69/h flex is the cheapest that clears VoxCPM2's ~8 GB plus
   headroom for faster-whisper's large-v3 model when accent QA runs on the same worker).
   Workers min 0, max 3. Idle timeout 120 s. FlashBoot on.
3. Attach a network volume mounted at `/runpod-volume` (20 GB is plenty) so weights and
   cached reference clips survive a worker restart. `handler.py` falls back to `/tmp` when no
   volume is attached (local testing), but every fresh worker then re-downloads the model.
4. Environment variables:

   | Var | Default | Purpose |
   |---|---|---|
   | `VOXCPM_MODEL` | `openbmb/VoxCPM2` | passed to `VoxCPM.from_pretrained` |
   | `WHISPER_MODEL` | `large-v3` | passed to `faster_whisper.WhisperModel`, loaded lazily |
   | `HF_HOME` | `/runpod-volume/hf` | Hugging Face cache directory |

5. Copy the endpoint id into `.env`:

   ```
   TTS_PROVIDER=voxcpm2-runpod
   RUNPOD_API_KEY=...
   RUNPOD_VOXCPM2_ENDPOINT_ID=<id>
   ```

6. Smoke it directly (bypassing the pipeline) once the endpoint is live:

   ```sh
   curl -s https://api.runpod.ai/v2/$RUNPOD_VOXCPM2_ENDPOINT_ID/runsync \
     -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" \
     -d '{"input":{"op":"tts","text":"(voz adulta, tom profissional, sotaque de Lisboa) Olá, isto é um teste.","cfg_value":2.0,"inference_timesteps":10,"seed":42}}'
   ```

   Expected: `{"id":"...","status":"COMPLETED","output":{"audio_b64":"...","sample_rate":48000,"gpu_seconds":...,"format":"wav"}}`.
   Without a `reference_audio_b64`, VoxCPM2 falls back to its default voice — useful for a
   quick liveness check, but never for production narration (see below).

## Request / response contract

Matches `packages/tts/src/adapters/voxcpm2Runpod.ts` exactly; this handler is that adapter's
counterpart, not a generic VoxCPM2 API.

**`op: "tts"`** — `input`:

```json
{
  "op": "tts",
  "text": "(voz adulta, tom profissional e caloroso, sotaque de Lisboa, ritmo moderado)Apartamento T três em Lisboa...",
  "reference_audio_b64": "<base64 wav, optional>",
  "reference_transcript": "exact transcript of the reference clip, optional",
  "cfg_value": 2.0,
  "inference_timesteps": 10,
  "seed": 42,
  "speaking_rate": 1.0,
  "sample_rate": 48000
}
```

`reference_audio_b64` is decoded and cached at `/runpod-volume/refs/<sha256-of-the-bytes>.wav`
(or `/tmp/voxcpm2-refs/...` without a volume) keyed by content hash, so a tenant's reference
clip is written to disk once and reused across every narration request for that voice, on
every worker that has seen it before. `speaking_rate` and `sample_rate` are accepted but not
forwarded to `model.generate()`: VoxCPM2 has no documented generation-time rate control, and
the model always renders at its native 48 kHz.

Response, `output`:

```json
{ "audio_b64": "<base64 wav>", "sample_rate": 48000, "gpu_seconds": 0.7, "format": "wav" }
```

**`op: "transcribe"`** — `input: {"audio_b64": "<base64 wav>"}` → `output: {"text": "..."}`,
via `faster_whisper.WhisperModel("large-v3").transcribe(..., language="pt")`. Used by
`RunpodWhisperJudge` in `packages/tts/src/accentQa.ts` for accent QA's word-error-rate check.

Any exception (missing key, model load failure, generation error) is caught and returned as
`{"error": "ExceptionType: message"}`, which RunPod reports as a `FAILED` job — the adapter
maps that to an `UpstreamError`.

## Reference clip preparation (per tenant voice profile)

VoxCPM2's accent is only as European as the reference clip fed to it. Before creating a
`VoiceProfile`:

1. **Licensed pt-PT speaker**, 20–30 seconds, clean recording (quiet room, no music/effects),
   mono WAV, 16 kHz or higher — rich in pt-PT-distinguishing phonemes (the `dezasseis` /
   `dezassete` / `catorze` family, open vowels, the European `s` at word end).
2. **Exact transcript** of that clip, word for word including punctuation — this is
   `reference_transcript` / `prompt_text`, and VoxCPM2's "ultimate cloning" mode (clip +
   transcript together) tracks the accent far better than the clip alone.
3. **Signed consent** from the speaker, stored and referenced as `consent_doc_ref` on the
   `VoiceProfile`. `packages/tts`'s `narrate()` refuses to run a `voxcpm2-*` provider without
   it (`ValidationError`), independent of anything this worker does — do not try to route
   around that check.
4. Upload the clip to the tenant's object store and set `reference_audio_key` on the profile;
   the pipeline passes it to `getReferenceAudio` and base64-encodes it for this worker.

## Accent spike procedure

Accent is not selectable on VoxCPM2 — it has to be verified empirically per reference clip
before a `VoiceProfile` goes to production (`pnpm cli spike tts`, or by hand):

1. Synthesise the 20 shibboleth sentences in `evals/accent/` with the candidate reference
   clip and transcript.
2. Run `op: "transcribe"` (or the standalone Whisper judge) and compute word error rate
   against the normalised input text; require ≤ 8%.
3. Get a European-vs-Brazilian judgment on each clip (Gemini audio judge, or a native
   listener) and require ≥ 90% confidence / agreement that it is European Portuguese.
4. A clip that fails either bar does not become a `VoiceProfile` reference — re-record or
   pick a different reference and repeat. This is the same check `runAccentQa` in
   `packages/tts/src/accentQa.ts` runs per narration in production (sampled 20%), just done
   once up front here for the reference clip itself.

## Cost and latency

| Item | Value |
|---|---|
| L4 flex | $0.69 per hour, billed per second while a worker is active |
| Warm p50 per listing (~70 s of audio, RTF ≈ 0.30) | ≈ 21 s GPU → ≈ $0.004 |
| Cold start | 60–120 s fresh, faster with FlashBoot warm snapshots |
| Idle cost | 120 s idle timeout after the last request |
| faster-whisper large-v3 (accent QA, lazy-loaded) | adds VRAM and a load pause on a worker's first `transcribe` call |

## Production alternative: `voxcpm2-http` (vLLM-Omni Pod)

`serve-omni.sh` runs VoxCPM2 under `vllm serve openbmb/VoxCPM2 --omni` on a RunPod **Pod**
(not Serverless) kept warm, exposing an OpenAI-audio-compatible `POST /v1/audio/speech` with
`ref_audio`. Needs ≥ 24 GB VRAM resident, but batches requests for RTF ≈ 0.12 versus ≈ 0.30
for this worker's per-request `voxcpm` library call — worth it once volume justifies keeping
a GPU warm instead of paying serverless cold starts. Point `packages/tts`'s `voxcpm2-http`
provider at it:

```
TTS_PROVIDER=voxcpm2-http
VOXCPM2_HTTP_BASE_URL=http://<pod-host>:8000
```

No RunPod Serverless queueing/polling in this path — `voxcpm2Http.ts` posts and reads the WAV
body directly, so `handler.py`'s `/runsync`+`/status` contract does not apply to it.
