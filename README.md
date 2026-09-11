# Imóvel em Voz

Production pipeline that turns Portuguese property listings into persuasive European Portuguese (pt-PT) marketing copy and a natural pt-PT voice-over.

- **Copy**: Gemini 2.5 Pro (JSON mode) through the same OpenAI-wire request code as the existing chat function.
- **Language gate**: AMALIA-9B-0626-DPO served by vLLM on RunPod, used as an editor only, followed by deterministic fact, lexicon and grammar validators and a Gemini judge.
- **Voice**: VoxCPM2 on RunPod with a cloned, licensed European Portuguese reference voice, ffmpeg loudness post, optional accent QA.
- **Listings**: agency CSV/XML feeds and Casafari in production; Parse.bot / Piloterr wrappers for the MVP spike. Only owned or represented listings get copy and audio.

The full design is in [`docs/architecture.md`](docs/architecture.md). Engineering rules are in [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## Layout

```
apps/       api (Fastify) · worker (pg-boss) · cli (pt-pipeline)
packages/   core · llm · ptpt-qa · tts · ingestion · storage · db · observability
infra/      runpod (amalia, voxcpm2) · cloudrun · docker · supabase
evals/      golden set · accent set · runners
docs/       architecture · conventions · legal · runbooks
```

## Quick start

```sh
pnpm install
cp .env.example .env            # fake providers by default, no keys needed
pnpm lint && pnpm typecheck && pnpm test
pnpm smoke                       # runs one listing end to end with fake providers
```

With real providers, fill in `.env` (`LLM_PROVIDER=gemini`, `GATE_EDITOR=amalia`, `TTS_PROVIDER=voxcpm2-runpod`, keys and endpoint ids) and run:

```sh
pnpm cli import-csv evals/golden/listings/sample.csv
pnpm cli run <listingId>
```

## Spikes before production

1. `pnpm cli spike tts` — VoxCPM2 pt-PT accent go/no-go with a cloned reference voice.
2. `pnpm cli spike amalia` — RunPod cold start, latency and editor fix rate on the editor golden set.
3. `pnpm cli spike sources` — Parse.bot Imovirtual, Piloterr idealista.pt and Casafari field coverage.

See `infra/runpod/*/README.md` for deploying the GPU endpoints.
