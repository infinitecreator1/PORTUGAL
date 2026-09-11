# Runbook: GPU cold starts

**Symptom.** Gate or narrate steps take 90–150 s instead of 5–25 s; `provider_errors_total{provider="runpod-vllm",code="timeout"}` rises; jobs sit in `gating`/`narrating`.

**Cause.** RunPod scaled the endpoint to zero and a fresh worker is loading weights.

**Checks.**
1. RunPod console → endpoint → Workers: is a worker in "initializing"?
2. `curl https://api.runpod.ai/v2/$ID/health -H "Authorization: Bearer $RUNPOD_API_KEY"` shows `workers.idle`/`running`.
3. FlashBoot enabled? Network volume attached with `HF_HOME` on it?

**Fix.**
- Nothing to do for a single cold start: the worker retries with a 240 s timeout on the editor and 300 s on voice.
- Repeated cold starts during business hours: set `workersMin: 1` on the endpoint (≈ $650/month for the A40 tier) or raise `idleTimeoutSeconds` to 300.
- Cold start above 5 minutes: the volume is missing and weights are downloading each time. Attach the volume and set `HF_HOME=/runpod-volume/hf`.

**Prevention.** The worker pre-warms both endpoints when the queue is non-empty (health call before the first job of a batch).
