# Engineering conventions

These rules apply to every package and app in this monorepo. `packages/core` is the shared contract: schemas, interfaces, config, errors. Other packages implement against it and never redefine its types.

## Toolchain

- Node 22, pnpm 10 workspaces, TypeScript 5.6 in `strict` mode. Root `tsconfig.base.json`; each package has `tsconfig.json` extending it with `"include": ["src", "test"]`.
- ESM only (`"type": "module"`). `moduleResolution: Bundler`, so relative imports are extensionless (`./foo`, not `./foo.js`).
- Packages export source directly: `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`. No build step for libraries. Apps run with `tsx` and are bundled with `tsup` for Docker.
- Package names: `@imovel/<name>`. Workspace dependencies use `"@imovel/core": "workspace:*"`. Shared third-party versions come from the pnpm catalog (`"zod": "catalog:"`); other dependencies pin a caret range in the package's own `package.json`.
- Scripts every package has: `typecheck` (`tsc --noEmit -p tsconfig.json`). Tests live in `test/**/*.test.ts` or next to source as `*.test.ts` and run from the root with `vitest`.

## Code

- Validate at boundaries with zod schemas from `@imovel/core`. Inside a package, trust the types.
- Every HTTP client takes an injectable `fetch` (`opts.fetch ?? globalThis.fetch`) so tests pass a fake. Tests never touch the network.
- Every provider adapter implements a `@imovel/core` interface and is registered by a string id that matches the `.env` option (`LLM_PROVIDER`, `GATE_EDITOR`, `TTS_PROVIDER`, `STORAGE_PROVIDER`).
- Each stage ships a `fake` adapter that behaves deterministically so the whole pipeline runs offline (`pnpm smoke`).
- Errors extend `PipelineError` from `@imovel/core` and carry `retryable`. Map upstream 429 → `RateLimitError`, 402 → `BillingError`, 5xx → `UpstreamError`, timeouts → `TimeoutError`, other 4xx → `RequestError`.
- Logging through `@imovel/observability` (pino). Never log prompts containing agent contacts, API keys, or full listing payloads; log hashes and token counts.
- Portuguese text in prompts, lexicon and fixtures is European Portuguese under the 1990 orthographic agreement. Numbers in speech use pt-PT forms (`catorze`, `dezasseis`, `dezassete`, `dezanove`).
- Money is whole euros formatted `350 000 €`; rents `1 250 €/mês`; areas `118 m²`; typology `T3`.

## Tests

- Unit tests for every pure module (normalisers, validators, lexicon, dedup, hashing).
- Contract tests for every adapter using recorded JSON fixtures under `test/fixtures/` and an injected fake `fetch`.
- A test that needs a real key must skip itself when the key is absent (`it.skipIf(!process.env.GEMINI_API_KEY)`).

## Git

- Branch from `main`, conventional commit messages (`feat(tts): pt-PT number normaliser`).
- CI runs lint, typecheck, tests, the fake-provider smoke and the golden eval.
