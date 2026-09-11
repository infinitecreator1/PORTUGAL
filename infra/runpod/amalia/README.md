# AMALIA-9B on RunPod Serverless (vLLM)

AMALIA is the pt-PT language gate. It runs as an OpenAI-compatible vLLM server on RunPod Serverless so the pipeline pays per second of GPU time and scales to zero.

## Model facts (verified September 2026)

- `amalia-llm/AMALIA-9B-0626-DPO`, Apache-2.0, released 1 July 2026.
- Llama architecture (42 layers, hidden 4096, 8 KV heads, vocab 128k), 32k context, bf16 weights 18.3 GB.
- ChatML template with a built-in pt-PT system prompt; the pipeline sends its own editing system prompt.
- P3B3 pt-PT score 95.9 (best open model). No editing benchmark, hence the golden editor set in `evals/golden/editor`.

## Deploy

1. RunPod console → Serverless → New Endpoint → "vLLM" quick deploy, or create it with the values in `endpoint.json`.
2. Model: `amalia-llm/AMALIA-9B-0626-DPO`. GPU: 48 GB tier (A40 / A6000 / L40S). Workers min 0, max 3. Idle timeout 120 s. FlashBoot on.
3. Attach a 40 GB network volume mounted at `/runpod-volume` and set `HF_HOME=/runpod-volume/hf` so weights download once.
4. Environment: copy the `env` block from `endpoint.json`.
5. Copy the endpoint id into `.env`:

```
GATE_EDITOR=amalia
RUNPOD_API_KEY=...
RUNPOD_AMALIA_ENDPOINT_ID=<id>
AMALIA_MODEL=amalia-llm/AMALIA-9B-0626-DPO
```

6. Smoke it:

```sh
curl -s https://api.runpod.ai/v2/$RUNPOD_AMALIA_ENDPOINT_ID/openai/v1/chat/completions \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"amalia-llm/AMALIA-9B-0626-DPO","messages":[{"role":"user","content":"Corrige para português europeu: O banheiro fica no térreo."}],"temperature":0.2,"max_tokens":64}'
```

Expected: a reply using "casa de banho" and "rés-do-chão".

## Cost and latency

| Item | Value |
|---|---|
| A40 flex | $1.22 per hour, billed per second while a worker is active |
| Cold start | 60–120 s fresh, 7–15 s with FlashBoot warm snapshots |
| Warm p50 per listing | about 6 s for the seven fields, prefix-cached system prompt |
| Idle cost | 120 s idle timeout after the last request |
| Always-on option | `workersMin: 1` ≈ $650 per month |

## Spike checklist (`pnpm cli spike amalia`)

- Measure cold start and warm latency over 10 requests.
- Run the 30 editor cases; require ≥ 90% of injected errors fixed and zero fact changes.
- Try `temperature 0` versus `0.2`; keep the one with fewer fact-diff failures.
- Optional: AWQ int4 on an L4 and re-run the editor set before changing the GPU tier.

## Dev alternative

`llama-server -m AMALIA-9B-0626-DPO-Q8_0.gguf -c 8192 --jinja --port 8080` (GGUF from `layerx-labs/AMALIA-9B-0626-DPO-GGUF`) and the `llamacpp` adapter in `packages/llm`.
