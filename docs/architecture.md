# pt-PT Property Description + Voice-Over Pipeline (repo: `portugal`)

## Context

You want a commercial pipeline that ingests Portuguese property listings, writes persuasive marketing copy with Gemini, forces that copy through AMALIA-9B as a strict European Portuguese gate, and narrates the result with a natural pt-PT voice. Everything is built in the empty `infinitecreator1/portugal` repo. The geothermal repo is not touched.

Facts established during planning that shape the design:

- **The reusable Gemini code in this account is one file**: `pulse-robot-template-22875/supabase/functions/chat/index.ts`. It calls the Lovable AI Gateway with the OpenAI chat-completions wire format (`google/gemini-2.5-flash`, zod-validated body, bearer auth, streaming). There is no description module and no voice module in either repo. Your production Gemini modules live in a separate GitHub account this session cannot reach.
- **Answer to "can you work without it":** yes. The pipeline is built against two interfaces, `LLMClient` and `TTSProvider`. The Gemini adapter is ported from the chat function's request code, which is the same OpenAI wire format Google exposes directly. When you later want your production description module wired in, I need only its request and response contract (or the code) and it becomes one more adapter. Nothing in the MVP blocks on it.
- **Voice is VoxCPM2** (your decision). Verified Sept 2026: OpenBMB, 2B params, Apache-2.0, 30 languages including "Portuguese" with no pt-PT/pt-BR distinction, 48 kHz output, voice cloning from a 16 kHz reference clip, "ultimate cloning" with clip plus transcript, style control by a parenthesised instruction, RTF about 0.30 with the Python library and about 0.12 with vLLM-Omni, roughly 8 GB VRAM for the library and 24 GB for vLLM-Omni. Accent is not selectable. The pt-PT accent must come from a cloned European Portuguese reference voice. That is unverified until the Phase 0 spike.
- **AMALIA runs on RunPod** (your decision). Verified: `amalia-llm/AMALIA-9B-0626-DPO`, Apache-2.0, Llama architecture (vLLM-compatible), 32k context, ChatML template with a built-in pt-PT system prompt, 18.3 GB bf16, GGUF Q8 9.7 GB. P3B3 pt-PT score 95.9 versus 88.3 for the best open baseline. No published sampling guidance and no editing benchmark, so the gate contract below is deliberately narrow.
- **Scope is owned or represented listings only** (your decision). Third-party portal data is ingested for analytics only and never gets copy or audio.
- **Casafari is the right production data source.** It is a Lisbon-based licensed B2B aggregator covering Portugal with listings already deduplicated across Idealista, Imovirtual and other portals, price history, photos, and agency data. Its docs sit behind a login and pricing is by sales conversation, so exact field names are unverified until your key arrives. Parse.bot and Piloterr are unofficial scrapers: fine for the MVP spike, not as good. The `ListingSource` interface makes the swap a one-adapter change.

The deliverable after approval is a working MVP in `portugal` plus this document committed as `docs/architecture.md`.

---

## 1. Architecture

```
SOURCES        Casafari API (prod)     Imovirtual · Idealista.pt via Parse.bot / Piloterr (MVP)     Agency CSV/XML feed
                      │                                  │                                              │
                      ▼                                  ▼                                              ▼
INGESTION      ┌──────────────── packages/ingestion ──────────────────────────────────────────────────────┐
(apps/worker)  │ ListingSource adapter → token-bucket limiter → circuit breaker → paginated fetch (cursor) │
               │ → normalize to canonical Listing (zod) → PII policy → dedup exact + fuzzy → ownership     │
               └───────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                   ▼
DATA           ┌──────────────── Postgres (Supabase) ─────────────────────────────────────────────────────┐
               │ tenants · api_keys · listings · listing_versions · listing_groups · jobs · job_steps      │
               │ generations · gate_reports · narrations · artifacts · voice_profiles · generation_profiles│
               │ review_queue · cost_events · tenant_budgets · webhooks · tts_cache · ingest_runs          │
               └───────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                   ▼  pg-boss queues (same Postgres)
PIPELINE       ┌──────────────── apps/worker (Node 22, Cloud Run) ────────────────────────────────────────┐
               │ ① generate   packages/llm      Gemini 2.5 Pro, JSON mode, via OpenAI-compat endpoint     │
               │ ② gate       packages/llm      AMALIA-9B on RunPod Serverless vLLM (edit-only)           │
               │              packages/ptpt-qa  fact-diff · pt-BR lexicon · grammar · edit-ratio · judge  │
               │              pass → ③   fail → retry ladder → review_queue                               │
               │ ③ narrate    packages/tts      normalize pt-PT → chunk → VoxCPM2 on RunPod (cloned voice)│
               │              → ffmpeg concat + loudnorm → mp3 + wav → accent QA (ASR + audio judge)      │
               │ ④ publish    packages/storage  Supabase Storage (signed URLs) → HMAC webhook             │
               └───────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                   ▼
DELIVERY       apps/api (Fastify)  /v1/listings/import · /v1/jobs · /v1/jobs/:id · /v1/listings/:id/outputs
               /v1/reviews/:id/approve|reject · /v1/webhooks · /v1/profiles · API keys per tenant
OPS            pino (PII-redacted) → OpenTelemetry traces per step → metrics · cost ledger · budgets
```

Every external dependency sits behind an interface with at least two adapters, so a model or vendor swap is a config change:

| Interface | Default adapter | Alternates shipped |
|---|---|---|
| `LLMClient` | `gemini` (Google OpenAI-compat endpoint) | `lovable-gateway`, `runpod-vllm` (AMALIA), `llamacpp` (dev), `production-gemini` stub for your other account's module |
| `TTSProvider` | `voxcpm2-runpod` | `elevenlabs` (pt-PT voices), `gemini-cloud-tts` (pt-PT Preview) |
| `ListingSource` | `csv-feed` (MVP), `casafari` (production) | `imovirtual-parsebot`, `idealista-piloterr`, `idealista-parsebot`, `idealista-official` (partner API, stub) |
| `ObjectStore` | `supabase-storage` (S3 protocol) | `s3`, `fs` (tests) |

## 2. Tech stack

| Layer | Choice | Why | Swap path |
|---|---|---|---|
| Language | TypeScript 5.6, Node 22, pnpm workspaces, `strict: true` | The only reusable code is TS. Your team runs TS + Supabase. | none needed |
| API | Fastify 5 + `fastify-type-provider-zod` + `@fastify/swagger` | Fast, schema-first, zod already in the house style, OpenAPI for free | Hono |
| Queue | pg-boss 10 | Runs inside Postgres, transactional enqueue, retries, cron, dead-letter, singleton keys. Volume is far below where Redis matters. | BullMQ + Redis above ~50 jobs/s |
| Database | Supabase Postgres, Drizzle ORM, SQL migrations checked in | Same platform as your existing project. RLS pattern copied from migration `20251029012057_…` (`app_role`, `has_role()`) extended to `has_tenant_role()` | any Postgres |
| Storage | Supabase Storage via S3 protocol (`@aws-sdk/client-s3`), private bucket, signed URLs | Same platform, worker code is plain S3 | S3 / R2 by endpoint change |
| Generation LLM | `gemini-2.5-pro` ($1.25 in / $10 out per 1M, `reasoning_effort: low`) with `gemini-2.5-flash` cheap tier; `gemini-3.7-flash` behind an A/B flag | Persuasion needs the Pro tier. JSON mode. Model ID is config. | any OpenAI-wire model |
| Judge LLM | `gemini-2.5-flash` (MVP), `gemini-2.5-pro` (production) | The AMALIA authors judged P3B3 with Gemini 2.5 Pro | same |
| pt-PT gate | AMALIA-9B-0626-DPO on RunPod Serverless, image `runpod/worker-v1-vllm`, 48 GB tier (A40 $1.22/h flex) | bf16 needs more than 24 GB once KV cache is added. A40 is the cheapest 48 GB tier. | L4 24 GB with AWQ int4 (Phase 0 spike), or a Pod |
| Voice | VoxCPM2 on RunPod, 24 GB tier (L4 $0.69/h flex) | Your decision. Cloned pt-PT reference voice per tenant. | ElevenLabs / Gemini-TTS adapters |
| Audio post | ffmpeg via `execa` | concat, EBU R128 loudness, MP3 encode | none |
| Accent QA | Whisper large-v3 (pt) on the same RunPod worker + Gemini audio judge | Catches pt-BR drift in the synthesised voice | none |
| Ingestion HTTP | `undici` + `bottleneck` + `opossum` | Retries with jitter, per-source token bucket, circuit breaker | none |
| Tests | vitest, `msw` v2 recorded fixtures | | |
| Observability | pino, OpenTelemetry SDK, OTLP → Grafana Cloud | | any OTLP backend |
| CI | GitHub Actions: lint, typecheck, test; golden eval on prompt/model changes | | |
| Deploy | Cloud Run europe-west1 (api, worker); RunPod for GPUs; GCP Secret Manager | EU residency, stateless Node services | Fly.io |

## 3. Data flow, hop by hop

### 3.1 Canonical `Listing` (zod, `packages/core/src/schemas/listing.ts`)

```ts
{
  id: uuid, tenant_id: uuid,
  source: 'casafari' | 'imovirtual-parsebot' | 'idealista-piloterr' | 'idealista-parsebot' | 'idealista-official' | 'csv-feed' | 'xml-feed' | 'api',
  source_id: string, source_url: string | null,
  ownership: 'owned' | 'represented' | 'third_party',      // gate for generation
  consent_ref: string | null,                               // contract reference for 'represented'
  transaction: 'sale' | 'rent',
  property_type: 'apartamento' | 'moradia' | 'terreno' | 'loja' | 'escritorio' | 'armazem' | 'predio' | 'quinta' | 'outro',
  typology: 'T0'|'T1'|'T2'|'T3'|'T4'|'T5'|'T6+' | null,    // normalised from "3 quartos", "T3+1", "3 bedrooms"
  price: number | null, currency: 'EUR', price_period: 'total' | 'month' | null,   // whole euros; 'month' for rent
  area: { gross_m2?: number, useful_m2?: number, plot_m2?: number },
  floor: string | null, year_built: number | null, bathrooms: number | null,
  condition: 'novo' | 'usado' | 'renovado' | 'em_construcao' | 'para_recuperar' | null,
  location: { district, municipality, parish?, neighbourhood?, address?, postal_code? (dddd-ddd), lat?, lng? },
  features: string[],            // closed taxonomy: 'varanda','garagem','elevador','piscina','ar_condicionado','roupeiros',...
  features_raw: string[],        // portal strings kept for audit
  energy_certificate: 'A+'|'A'|'B'|'B-'|'C'|'D'|'E'|'F'|'isento'|null,
  photos: { url, room?, order, stored_key? }[],   // downloaded only when ownership != third_party
  agent: { name?, agency?, agency_id?, phone?, email? },   // contacts dropped for third_party, AES-256-GCM encrypted otherwise
  description_original: string | null, language_original: 'pt-PT'|'pt-BR'|'en'|'other'|null,
  fetched_at, content_hash: sha256(transaction, typology, price, areas, floor, energy, sorted features, municipality, parish, description_original),
  raw_ref: string | null         // object key of the raw payload; 30-day retention for third_party
}
```

Ownership auto-detection: tenants register their agency identifiers per source (`tenant_agencies(tenant_id, source, agency_id)`). A Casafari or portal listing whose `agent.agency_id` matches becomes `owned`; everything else is `third_party`. `third_party` never enters generation unless `tenants.allow_third_party_generation = true` **and** `tenants.legal_signoff_at` is set.

Dedup: exact on `(tenant_id, source, source_id)`. Cross-source fuzzy fingerprint on `(same transaction, typology, municipality, parish) + area ±3% + price ±2% + normalised address match or both null`, linked in `listing_groups`, canonical = owned > represented > earliest. Generation runs once per group. `content_hash` change on a material field creates a `listing_version` and a new job; `fetched_at` churn does not.

### 3.2 Job state machine (`jobs.status`)

```
queued → generating → generated → gating → gated_pass → narrating → narrated → publishing → published
                                       ├→ gated_fail(retry_amalia) → gating (attempt 2, strict)
                                       ├→ gated_fail(regenerate)   → generating (loop+1, constraints added)
                                       └→ gated_fail(needs_review) → review_queue → (approve) → narrating
any step infra error → retrying → dead_letter → failed        published_partial (text ok, audio failed, require_audio=false)
```

Idempotency key: `sha256(listing_id | content_hash | generation_profile_id | voice_profile_id)`, also the pg-boss `singletonKey`. Each step writes a `job_steps` row (input hash, output ref, latency, usage, cost). Unchanged inputs reuse the prior step output. `tts_cache(text_sha, voice_profile_id)` skips synthesis when narration text and voice are unchanged.

Retry policy per step:

| Step | Retried on | Attempts / backoff | On exhaustion |
|---|---|---|---|
| ingest page | 429 (honour `Retry-After`), 5xx, timeout | 5, 2 s → 60 s full jitter | run failed, resume from cursor next schedule |
| generate | 429/5xx/timeout/JSON or zod failure | 4, 5 s → 180 s | failed |
| gate, AMALIA infra | 429/5xx/timeout/cold start | 5, 10 s → 300 s | failed (never silently bypassed) |
| gate, quality | validators fail | ladder in 3.4 | review_queue |
| narrate | 429/5xx/timeout | 4, 5 s → 180 s | published_partial or failed |
| publish/webhook | 5xx/timeout | 6, 30 s → 30 min | published + `webhook_deliveries.status = failed` + alert |

### 3.3 Step ① generate (Gemini)

Request built in `packages/llm/src/generator.ts` from the `Listing` (minus PII, photos, raw) plus the tenant's `generation_profile` (tone, audience, target length, brand notes, CTA template). Uses the chat function's request shape (system + messages, OpenAI wire) with `temperature 0.7`, `top_p 0.95`, `response_format: json`, `max_tokens 1800`, `reasoning_effort: low`, streaming off so `usage` is returned.

Output schema `GenerationResult`:

```ts
{
  titulo: string,                 // 20–90 chars
  resumo: string,                 // 80–240 chars
  descricao: string,              // 3–5 paragraphs, 600–2600 chars by profile
  destaques: string[],            // 4–8 bullets, 8–70 chars each
  localizacao: string,            // only facts from location + features
  cta: string,
  narracao: string,               // 110–160 words, spoken register, no lists or symbols — this is what gets voiced
  factos_usados: string[]         // field paths used, checked by the fact validator
}
```

System prompt (pt-PT, `packages/llm/prompts/generate.pt-PT.md`), core rules:

> És um copywriter imobiliário sénior em Portugal. Escreves exclusivamente em português europeu (norma de Portugal, Acordo Ortográfico de 1990), no registo profissional das mediadoras portuguesas e dos portais idealista.pt e imovirtual.com. Usa apenas os dados fornecidos; nunca inventes características, medidas, distâncias, escolas, transportes, obras, prazos ou rentabilidades; omite o que não souberes. Usa a tipologia portuguesa (T0–T6+), "m²", preços como "350 000 €" e rendas como "1 250 €/mês". Vocabulário de Portugal: moradia, apartamento, rés-do-chão, casa de banho, arrecadação, lugar de garagem, lavandaria, roupeiros, caixilharia, pavimento flutuante, esquentador, gás canalizado, certificado energético, IMI, arrendamento, remodelado, pronto a habitar, exposição solar, vista desafogada, áreas generosas. Proibido: gerúndio progressivo ("está fazendo"), "você" explícito, "a gente", "alto padrão", "área gourmet", "lazer completo", "aluguel", "reformado" no sentido de renovado, "banheiro", "geladeira", "ônibus", "shopping", "academia", "térreo", "IPTU", "habite-se". Sem promessas de retorno garantido, sem linguagem discriminatória, sem emojis, no máximo uma exclamação. Tom persuasivo, sóbrio, concreto. Responde apenas com JSON válido conforme o esquema.

Pre-validator before the gate: numbers, typology, energy class and place names in the output must be a subset of those in the listing. Invented facts trigger a regenerate, max 2.

Photo grounding (production, owned listings only): Gemini Flash over up to 8 stored photos returns features from the closed taxonomy with confidence. Only features with confidence ≥ 0.8 that are absent from structured data are passed, phrased non-assertively ("com aspeto de"), never numbers. Off by default because it is the one place vision hallucination can enter.

### 3.4 Step ② gate (AMALIA + validators)

AMALIA is an **editor, not a generator**. It receives plain text per field, returns plain text. The diff is computed locally with `diff-match-patch`. This avoids asking a 9B model for reliable JSON and keeps the hallucination surface small.

Per field (`descricao`, `resumo`, `destaques` joined by newlines, `localizacao`, `cta`, `narracao`, `titulo`), one request:

```
system: És uma revisora linguística especializada em português europeu para o mercado imobiliário.
        Recebes um texto e devolves o mesmo texto corrigido para português europeu impecável
        (norma de Portugal, AO90): vocabulário e ortografia do Brasil substituídos pelas formas de
        Portugal, gramática, pontuação, colocação dos pronomes clíticos ("Trata-se de…",
        "Contacte-nos"), "estar a + infinitivo", artigo antes de possessivo, registo profissional
        sem "você". Regras invioláveis: não reescreves nem reordenas frases; não acrescentas nem
        removes informação; não alteras números, tipologia, áreas, preços, classe energética, nomes
        de localidades, ruas, agências ou pessoas; mantém a divisão em parágrafos. Se o texto já
        estiver correto, devolve-o igual. Não comentes. Devolve apenas o texto revisto.
user:   <texto>          (strict retry appends: "Corrige obrigatoriamente: [lexicon hits]. Altera apenas palavras isoladas e pontuação.")
```

Parameters: `temperature 0.2`, `top_p 0.9`, `repetition_penalty 1.05`, `max_tokens = 1.5 × input tokens + 64`, fixed `seed`, timeout 90 s (240 s on first call after cold start). vLLM flags on RunPod: `MODEL_NAME=amalia-llm/AMALIA-9B-0626-DPO`, `DTYPE=bfloat16`, `MAX_MODEL_LEN=8192`, `MAX_NUM_SEQS=16`, `ENABLE_PREFIX_CACHING=1` (the system prompt becomes nearly free). Endpoint `https://api.runpod.ai/v2/<endpoint>/openai/v1`, bearer `RUNPOD_API_KEY`.

Validators run after AMALIA in `packages/ptpt-qa`, deterministic except the judge:

| Validator | Rule | Fail action |
|---|---|---|
| `factDiff` | Multisets of numbers with units (thousands separators normalised), money, typology tokens (`T\d\+?`), energy class, and place names (listing location fields plus capitalised multiword spans) must be identical before and after AMALIA. | hard fail |
| `lexiconScan` | Word-boundary, accent-aware regex over the curated pt-BR marker list (3.5). Zero `block` hits allowed. `warn` hits reported. | hard fail |
| `grammarPatterns` | `estar/andar/continuar + -ndo` progressive gerund, sentence-initial proclisis (`Me|Te|Se|Nos|Lhe` after `.`), `a gente`, `pra/pro`, possessive without article ("agende sua visita"), `próximo ao`. | hard fail |
| `editRatio` | Word-level change ratio ≤ 0.40, sentence count ±1, per-field length ratio 0.85–1.15. Above means over-editing. | retry strict |
| `shape` | Lengths within targets, paragraph count preserved, no markdown/emojis/URLs/phone/email, `narracao` has no lists or symbols, `€` and `m²` present when price/area given. | hard fail |
| `claimsCheck` | No "retorno garantido", "valorização garantida", "melhor investimento", discriminatory phrases. | hard fail |
| `judge` | Gemini, temperature 0, JSON: "Rate 0–100 for European Portuguese authenticity as written by a native pt-PT real-estate professional. Deduct 8 per Brazilian lexical item, 6 per Brazilian construction (progressive gerund, initial proclisis, default 'você'), 4 per pt-BR spelling, 5 for register mismatch. Return `{pt_pt_score, register_score, flagged_spans[{text, category, suggestion}]}`." | fail < 80, soft fail 80–89 |

Decision (`gate/decide.ts`): `pass` when every validator is ok and judge ≥ 90. Ladder: attempt 1 fails → AMALIA strict retry with hits quoted; attempt 2 fails or judge < 90 → Gemini regenerate with flagged spans and hits as negative constraints, then AMALIA again; loop 2 fails → `review_queue` with the diff and the full `gate_report`. Worst case 3 Gemini calls and 4 AMALIA calls. If the Phase 0 editor eval shows AMALIA fixes fewer than 90% of injected errors, config `gate.editor = 'gemini'` routes editing to a Gemini pt-PT revision prompt and keeps AMALIA as detector only. Every report records which editor ran.

Golden set: `evals/golden/listings/` (50 listings, native-written reference copy, Lisboa/Porto/Algarve/interior/islands mix) and `evals/golden/editor/` (30 Gemini-style outputs with injected Brazilianisms plus the facts that must survive). `pnpm eval:golden` reports mean and min judge score, block hits per 1k words, fact-diff pass rate, edit-ratio distribution, cost and latency. Merge thresholds on prompt or model changes: mean ≥ 92, min ≥ 85, zero block hits, 100% fact pass, ≥ 95% injected errors fixed.

### 3.5 pt-BR marker lexicon (starter, `packages/ptpt-qa/lexicon/pt-br-markers.yaml`)

Real-estate specific, severity-tagged, ~150 rows after a native reviewer pass in Phase 4. Starter rows:

| pt-BR marker | pt-PT | Severity |
|---|---|---|
| térreo | rés-do-chão | block |
| banheiro, lavabo | casa de banho, casa de banho de serviço | block |
| aluguel, locação, locatário | arrendamento, renda, arrendatário | block |
| reformado (= renovado) | remodelado, renovado | block |
| mobiliado | mobilado | block |
| pronto para morar | pronto a habitar | block |
| vaga(s) de garagem | lugar de garagem | block |
| academia (gym), shopping, playground | ginásio, centro comercial, parque infantil | block |
| ônibus, ponto de ônibus, metrô, trem | autocarro, paragem, metro, comboio | block |
| IPTU, ITBI, habite-se, matrícula do imóvel, cartório | IMI, IMT, licença de utilização, caderneta predial, conservatória | block |
| gás encanado, aquecedor a gás, boiler | gás canalizado, esquentador, termoacumulador | block |
| esquadrias, forro, piso laminado, porcelanato | caixilharia, teto falso, pavimento flutuante, grés porcelânico | block |
| porão, subsolo | cave, piso -1 | block |
| dormitório, cômodo(s), ambientes | quarto, divisão(ões) | block |
| lavanderia, área de serviço | lavandaria | block |
| sobrado, kitnet/quitinete, cobertura (penthouse) | moradia de dois pisos, T0/estúdio, penthouse | block |
| geladeira, açougue, sorvete, suco, café da manhã | frigorífico, talho, gelado, sumo, pequeno-almoço | block |
| interfone, porteiro eletrônico, zelador, síndico | intercomunicador, vídeo-porteiro, porteiro, administrador do condomínio | block |
| alto padrão, área gourmet, varanda gourmet, lazer completo, pet place, bairro nobre | de luxo, zona de refeições exterior, comodidades, área para animais, zona nobre | block |
| planejado(s), planejamento, armários planejados | por medida, planeamento, roupeiros por medida | block |
| suíte, cozinha americana, closet, guarda-roupa | suite, cozinha em open space, roupeiro | warn |
| a gente, pra, pro, legal, bacana, R$ | nós, para, ótimo, € | block |
| está/andam/continua + -ndo | estar a + infinitivo | block |
| Me/Se/Lhe at sentence start | enclisis (Trata-se, Contacte-nos) | block |
| sua/seu without article ("agende sua visita") | agende a sua visita | warn |
| próximo ao / à | próximo de, junto a | warn |
| você / vocês | impersonal, "o senhor", or omitted | warn |
| econômico, gênero, quilômetro, bônus, prêmio, cômodo | económico, género, quilómetro, bónus, prémio, cómodo | block |
| contato, registro, recepção, aspecto, perspectiva, seção, detectar, "de fato" | contacto, registo, receção, aspeto, perspetiva, secção, detetar, "de facto" | block |
| quatorze, dezesseis, dezessete, dezenove | catorze, dezasseis, dezassete, dezanove | block |

Must **not** flag (unit-tested for precision): AO90-shared forms `ação, ótimo, direto, atual, ideia, assembleia`; shared vocabulary `condomínio, garagem, piscina, elevador, varanda, terraço, quintal, churrasqueira, banheira, imóvel`; `fato` alone (a suit in pt-PT) outside "de fato"; `banheiro` inside proper names.

### 3.6 Step ③ narrate (VoxCPM2)

Input is the gated `narracao` field only, so the gate covers audio by construction.

1. **Normalise for speech** (`packages/tts/src/normalize/`), pt-PT rules, own implementation because `n2words` emits pt-BR forms:
   - numbers → words: `16 → dezasseis`, `19 → dezanove`, `350 000 € → trezentos e cinquenta mil euros`, `1 250 €/mês → mil duzentos e cinquenta euros por mês`, `125 m² → cento e vinte e cinco metros quadrados`, `125,5 → cento e vinte e cinco vírgula cinco`, feminine agreement (`duzentas`)
   - typology: `T3 → T três`, `T3+1 → T três mais um`, `T6+ → T seis ou superior`
   - ordinals and abbreviations: `2.º → segundo`, `R/C → rés-do-chão`, `n.º → número`, `R. → Rua`, `Av. → Avenida`, `Pç. → Praça`, `km → quilómetros`, `% → por cento`, `WC → casa de banho`, `IMI → I M I`
   - energy: `A+ → A mais`, `B- → B menos`
   - place-name glossary (`glossary.pt-PT.json`, respellings such as `Algés → al-jéch`) grown from accent QA failures
   - paragraph breaks become a 350 ms gap at concat time
2. **Chunk** at sentence boundaries to ≤ 300 characters per chunk, never mid-number.
3. **Synthesise** each chunk with the tenant's `voice_profile`:
   - `prompt_wav_path` (licensed pt-PT speaker, 20–30 s, clean, 16 kHz+ WAV, rich in pt-PT phonemes) and `prompt_text` (exact transcript) → ultimate cloning
   - style prefix inside the text: `(voz adulta, tom profissional e caloroso, sotaque de Lisboa, ritmo moderado)`
   - `cfg_value 2.0`, `inference_timesteps 10`, fixed `seed` per profile so consecutive chunks match
   - RunPod serverless worker (`infra/runpod/voxcpm2/handler.py`) wraps the `voxcpm` library, caches the reference WAV on the network volume, returns 48 kHz WAV as base64. Production alternative: a Pod running `vllm serve openbmb/VoxCPM2 --omni` exposing `/v1/audio/speech` with `ref_audio`, for batching and RTF 0.12.
   - `voice_profiles.consent_doc_ref` is required before a profile can be used. VoxCPM2's policy forbids impersonation and asks for labelling, so `outputs.ai_generated = true`.
4. **Post** with ffmpeg: concat with 350 ms silence between chunks, two-pass `loudnorm I=-16 TP=-1.5 LRA=11`, export `wav` (48 kHz mono) and `mp3` (128 kbps). Store duration, measured loudness, checksum, sample rate.
5. **Accent QA** (MVP-optional, production sampled 20%): Whisper large-v3 with `language=pt` transcribes the mp3; WER against the normalised text ≤ 8%. Gemini audio judge answers "Este áudio é português europeu ou do Brasil?" with a confidence; pass at ≥ 90% European. Fail → regenerate once with a new seed → then `review_queue`. Tenants with an ElevenLabs profile fail over to it.

Output `NarrationResult`: `{ wav_ref, mp3_ref, duration_s, loudness_lufs, chunks, provider, voice_profile_id, accent_qa: {wer, european_confidence, ok} | null, usage: {chars, gpu_seconds} }`.

### 3.7 Step ④ publish

Artefacts land at `{tenant}/listings/{listing}/jobs/{job}/…` in the private bucket. An `outputs` row holds the final JSON, the AMALIA diff, the gate report id and audio refs. The tenant webhook fires `job.completed` (HMAC-SHA256 over `timestamp.body`, `X-Idempotency-Key`, 6 retries), then the job is `published`.

## 4. Integrating your Gemini code and inserting AMALIA

- `packages/llm/src/openaiWireClient.ts` is a straight port of lines 93–132 of the chat function: same headers, same body shape, same 429/402 mapping, plus timeout, retry with jitter on 5xx/429, `usage` capture, and a non-streaming path that reads `choices[0].message.content`. The SSE parser from `Chatbot.tsx` lines 51–96 is ported as `sse.ts` for dashboard preview only. Adapters differ only in `baseUrl`, `apiKey`, model naming and capability flags (`jsonSchema`, `seed`, `reasoningEffort`):
  - `gemini`: `https://generativelanguage.googleapis.com/v1beta/openai`, `GEMINI_API_KEY`, model `gemini-2.5-pro`
  - `lovable-gateway`: `https://ai.gateway.lovable.dev/v1`, `LOVABLE_API_KEY`, model `google/gemini-2.5-pro`
  - `runpod-vllm`: `https://api.runpod.ai/v2/<id>/openai/v1`, `RUNPOD_API_KEY`, model `amalia-llm/AMALIA-9B-0626-DPO`
  - `llamacpp`: `http://localhost:8080/v1`, GGUF Q8 for offline dev
- `DescriptionGenerator` and `PtPtEditor` are interfaces. `GeminiDescriptionGenerator` and `AmaliaEditor` are the shipped implementations. Your production module from the other account plugs in as `ProductionGeminiDescriptionGenerator` returning the same `GenerationResult`; the gate and voice stages do not change.
- AMALIA sits between `generate` and `narrate` as its own pg-boss queue (`gate`). Narration never runs without a `gated_pass` row. That ordering is enforced in the worker, not by convention.
- The zod request validation, bearer-auth check (`auth.getClaims`) and error mapping from the chat function are reused in `apps/api`.

## 5. Risks and mitigations

| Risk | Why it is real | Mitigation |
|---|---|---|
| Gemini writes pt-BR-flavoured Portuguese | Most LLMs are pt-BR biased (P3B3 shows it) | pt-PT system prompt with explicit negatives, lexicon hits fed back on retry, AMALIA gate, judge threshold, golden set on CI |
| AMALIA changes facts or over-edits | 9B model, no editing benchmark, model card warns about hallucination | Edit-only contract, plain text in/out, `factDiff` hard fail, `editRatio` guard, temperature 0.2, per-field requests, fixed seed, diff stored for audit |
| AMALIA under-edits (passes pt-BR through) | Unknown proofreading strength | Lexicon and grammar regex run after AMALIA, judge is independent of AMALIA, retry ladder regenerates with Gemini, `gate.editor = 'gemini'` fallback if the editor eval fails |
| VoxCPM2 accent drifts to pt-BR | Training data is unlabelled "Portuguese"; accent is not a parameter | Ultimate cloning from a licensed pt-PT speaker, 20–30 s reference rich in pt-PT phonemes, style prefix, accent QA with ASR + audio judge, ElevenLabs pt-PT failover adapter. Phase 0 spike is a go/no-go. |
| Voice rights | Cloning needs a consenting speaker | `voice_profiles.consent_doc_ref` required; VoxCPM2 policy forbids impersonation; outputs labelled AI-generated |
| Number and abbreviation reading errors | TTS reads "16" as dezesseis | Own pt-PT normaliser with unit tests, glossary grown from QA failures |
| Gemini→AMALIA handoff (truncation, field mismatch) | pipeline stalls | zod on both ends, `max_tokens` sized to input, `finish_reason = length` → strict retry with paragraph chunking, input/output hashes stored |
| `response_format` / `seed` support on Google's OpenAI-compat endpoint | JSON reliability | Unverified — Phase 0 spike; fallback is prompt-instructed JSON + zod + one repair call |
| Wrapper APIs break or violate portal ToS | Parse.bot and Piloterr are unofficial; Apify actors are already deprecated | Adapters isolated, circuit breaker per source, contract tests with recorded fixtures, Casafari as the licensed production source, CSV/XML feed as the always-available path for owned listings |
| Casafari field mapping unknown | Docs behind login | Adapter written against the Casafari sandbox in Phase 7; `features_raw` and `raw_ref` keep unmapped data |
| Copyright and GDPR on portal data | Descriptions and photos belong to agencies; agent contacts are personal data | `ownership` gate, third-party rows lose contact fields and never download photos, 30-day raw retention, AES-256-GCM for owned contacts, RLS per tenant, PII redaction in logs, `docs/legal.md` with the processing register |
| RunPod cold starts | 60–120 s fresh boot, 7–15 s with FlashBoot | FlashBoot on, model on network volume, idle timeout 120 s, `min_workers 1` in business hours for production, worker pre-warms both endpoints when the queue is non-empty |
| Cost drift | Pro tier, thinking tokens, retries, GPU idle | `cost_events` per step, `tenant_budgets` soft alert / hard stop, `reasoning_effort: low`, Flash tier fallback flag, retry caps |
| Model deprecation | 2.5 Flash-Lite retires 16 Oct 2026; 3.x Flash pricing doubles 1 Jan 2027 | Model IDs and dated prices in config, golden set makes a swap a one-day job, ADR per swap |

## 6. Folder structure

```
portugal/
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  eslint.config.js  .env.example  README.md
├─ .github/workflows/ci.yml            lint · typecheck · test · golden eval on prompts/lexicon/model changes
├─ apps/
│  ├─ api/        Fastify: routes/{listings,jobs,reviews,savedSearches,webhooks,profiles,health}.ts  auth/{apiKey,supabaseJwt}.ts  plugins/{tenant,rateLimit,otel}.ts
│  ├─ worker/     pg-boss consumers: handlers/{ingest,generate,gate,narrate,publish,deadLetter}.ts  pipeline/stateMachine.ts  scheduler.ts
│  └─ cli/        pt-pipeline: import-csv · run <listingId> · review list|approve|reject · eval golden|accent · smoke · spike:tts|amalia|sources
├─ packages/
│  ├─ core/       zod schemas (Listing, GenerationResult, GateReport, NarrationResult, Job) · features/taxonomy.ts · config.ts (zod env) · errors · hash · crypto · pricing.ts (dated unit prices) · queue.ts · storage.ts
│  ├─ db/         drizzle schema · repositories · migrations/*.sql (tables, tenant_role, has_tenant_role(), RLS)
│  ├─ llm/        openaiWireClient.ts · sse.ts · retry.ts · json.ts · adapters/{gemini,lovable-gateway,runpod-vllm,llamacpp}.ts · generator.ts · amaliaEditor.ts · prompts/*.pt-PT.md
│  ├─ ptpt-qa/    lexicon/{pt-br-markers.yaml,scan.ts} · facts/{extract,diff}.ts · grammarPatterns.ts · editRatio.ts · shape.ts · claimsCheck.ts · judge/{judge.ts,judge.prompt.md} · gate/{runGate,decide}.ts
│  ├─ tts/        TTSProvider.ts · adapters/{voxcpm2-runpod,elevenlabs,gemini-cloud-tts}.ts · normalize/{numbers,currency,area,typology,ordinals,energy,abbrev,glossary}.ts · chunker.ts · audio/{concat,loudnorm,encode,probe}.ts · accentQa.ts · narrator.ts
│  ├─ ingestion/  ListingSource.ts · rateLimiter.ts · breaker.ts · runner.ts · dedup.ts · pii.ts · adapters/{csv-feed,xml-feed,casafari,imovirtual-parsebot,idealista-piloterr,idealista-parsebot,idealista-official}/{client,normalize}.ts
│  ├─ storage/    ObjectStore.ts · adapters/{supabase-s3,s3,fs}.ts
│  └─ observability/ logger.ts (pino, redact) · otel.ts · metrics.ts · costLedger.ts
├─ infra/
│  ├─ runpod/amalia/     endpoint.json (worker-v1-vllm env) · README
│  ├─ runpod/voxcpm2/    Dockerfile · handler.py (serverless) · serve-omni.sh (pod) · README
│  ├─ cloudrun/          Dockerfile.api · Dockerfile.worker (ffmpeg) · service.yaml
│  ├─ docker/            docker-compose.dev.yml (postgres, llama-server Q8, worker, api)
│  ├─ grafana/           dashboards/*.json · alerts/*.json
│  └─ supabase/          config.toml · migrations/ · seed.sql
├─ evals/
│  ├─ golden/listings/   50 listings + native-written reference copy · rubric.md
│  ├─ golden/editor/     30 injected-error cases with protected facts
│  ├─ accent/            20 shibboleth sentences + reference judgments
│  └─ run-golden.ts  run-accent.ts  reports/
└─ docs/  architecture.md (this plan) · ptpt-style-guide.md · legal.md · review-checklist.md · runbooks/{cold-start,gate-failures,source-outage,budget-breach}.md · adr/
```

Key exported interfaces (`packages/core`):

```ts
interface LLMClient { provider: string; capabilities: { jsonSchema: boolean; seed: boolean; reasoningEffort: boolean }; chat(req: ChatRequest, opts?: CallOptions): Promise<ChatResponse>; health(): Promise<{ ok: boolean; latency_ms: number }> }
interface DescriptionGenerator { generate(l: Listing, profile: GenerationProfile, extraConstraints?: string[]): Promise<GenerationResult> }
interface PtPtEditor { edit(text: string, opts: { strict: boolean; hints: string[] }): Promise<{ text: string; diff: Change[] }> }
interface Validator { name: string; run(ctx: GateContext): Promise<ValidatorResult> }
interface TTSProvider { limits(): { maxChars: number }; synthesize(chunk: { text: string; index: number }, profile: VoiceProfile, opts?: CallOptions): Promise<{ wav: Buffer; sampleRate: number; usage: { chars: number; gpu_seconds?: number } }> }
interface ListingSource { id: string; capabilities(): { search: boolean; detail: boolean; rpm: number }; search(q: SavedSearch, cursor?: string): Promise<{ items: RawSummary[]; next: string | null }>; detail(ref: { source_id: string; url?: string }): Promise<RawDetail>; normalize(raw: RawDetail, ctx: NormalizeContext): Listing }
interface ObjectStore { put(key, body, opts): Promise<{ key; bytes; sha256 }>; get(key): Promise<Buffer>; signedUrl(key, ttlSeconds): Promise<string> }
interface JobQueue { send(queue, data, opts?: { singletonKey?; retryLimit?; retryBackoff?; deadLetter? }): Promise<string>; work<T>(queue, handler): Promise<void>; schedule(queue, cron, data?): Promise<void>; size(queue): Promise<number> }
```

## 7. API (apps/api, all under `/v1`, tenant resolved from the API key)

| Route | Purpose |
|---|---|
| `POST /listings/import` | `{listings[], ownership, consent_ref?, generation_profile_id?, voice_profile_id?, run}` → `202 {imported, updated, job_ids[]}` |
| `POST /listings/import/file` | multipart CSV/XML + mapping id → `202 {run_id}` |
| `GET /listings/:id` · `GET /listings/:id/outputs` | canonical listing; latest published sections, gate summary, AMALIA diff, signed mp3/wav URLs (1 h) |
| `POST /jobs` · `POST /jobs/:id/run` · `GET /jobs/:id` · `GET /jobs` | create (idempotent), re-run from a step, status with step timeline and cost, list |
| `POST /reviews/:id/approve` · `/reject` | human review; approve may carry edited sections and triggers narrate |
| `POST/GET/PATCH/DELETE /saved-searches` | scheduled ingestion per source |
| `POST/GET/DELETE /webhooks` · `POST /webhooks/:id/test` | events `job.completed`, `job.failed`, `job.needs_review`, `listing.changed` |
| `/profiles/generation` · `/profiles/voice` CRUD | tenant profiles |
| `GET /health` · `GET /ready` | DB, queue, RunPod endpoints (cached 30 s) |

Auth: `Authorization: Bearer pk_live_<tenant8>_<32 base62>` hashed in `api_keys`; `@fastify/rate-limit` 120 rpm per key. Dashboard (production) uses Supabase JWT via the ported `auth.getClaims` check and `tenant_members`. Every table carries `tenant_id`; RLS via `has_tenant_role()`; worker and API use the service role with an explicit `withTenant()` query helper.

## 8. MVP versus production

| Area | MVP (4–5 weeks) | Production |
|---|---|---|
| Sources | CSV/XML feed + Imovirtual via Parse.bot (spike-gated) | + Casafari as primary, Idealista via Piloterr/Parse.bot, official Idealista partner API, scheduler per saved search |
| Generation | Gemini 2.5 Pro, JSON mode, one profile | Profiles per tenant, photo grounding, Flash tier routing, batch API for backfills, 3.7 Flash A/B |
| Gate | AMALIA on RunPod Serverless A40; all validators; judge on Flash; retry ladder; review via CLI + API | Judge on Pro plus 10% pre-AMALIA sampling, review UI, lexicon curation workflow, AWQ int4 on L4 if the spike passes, business-hours keep-warm |
| Voice | VoxCPM2 serverless handler, one cloned pt-PT profile, ffmpeg post, accent QA off by default | vLLM-Omni pod with batching, multiple profiles, accent QA sampled, ElevenLabs failover, intro/outro beds |
| API | API keys, import, jobs, outputs, reviews, webhooks; single tenant via env | Multi-tenant RLS dashboard on Supabase auth, Postgres-backed rate limits, usage metering, SLAs |
| Ops | pino + OTel + cost ledger, basic Grafana board, CI with golden eval | Alerts (gate pass < 80%/h, review rate > 15%, queue age > 30 min, cost/listing > 2× baseline, any 402), budgets, runbooks, load-tested to 10k listings/month, SLOs p50 < 90 s warm, p95 < 4 min |
| Legal | ownership gate, PII drop, consent doc on voice profiles, tenant terms flag | DPA templates, retention jobs, audit log export, processing register |

## 9. Cost and latency (verified Sept 2026 prices, USD)

Per listing, warm endpoints, including a 1.25× retry allowance on LLM steps:

| Step | Assumption | Cost |
|---|---|---|
| Gemini 2.5 Pro generate | 1.5k in, 800 out, ~400 thinking tokens at `reasoning_effort: low` | $0.018 |
| Gemini Flash judge | 2k in, 0.2k out | $0.002 |
| AMALIA on A40 flex $1.22/h | ~2.3k tokens across 7 fields, prefix-cached, batched, ~6 s GPU | $0.002 |
| VoxCPM2 on L4 flex $0.69/h | ~70 s audio at RTF 0.3 → ~21 s GPU | $0.004 |
| Accent QA (Whisper on the same worker + Flash audio judge), sampled 20% | | $0.001 |
| Ingestion: Parse.bot Imovirtual ~1.2 credits, or Casafari (quote-based) | | $0.01–0.03 |
| Storage | 8 MB per listing | negligible |
| **Total** | | **≈ $0.04–0.06 per listing** |

At 10,000 listings/month: about $400–600 variable, plus idle GPU at 120 s idle timeout (small), plus about $650/month if one AMALIA worker stays active in business hours for latency, plus fixed platform (Supabase Pro $25, Cloud Run ≈ $60, Grafana free tier). Flash for generation cuts the per-listing total to about $0.02. ElevenLabs as voice would add about $0.12 per listing.

Latency per listing, p50 warm: generate 10 s, gate 9 s (AMALIA 6 s + judge 3 s), narrate 25 s, post 2 s, total about 45–60 s. p95 with one retry loop 2.5–4 min; a cold start on each GPU endpoint adds 90–150 s. One A40 worker sustains roughly 400 listings/hour through the gate; one L4 worker roughly 150/hour through voice.

---

## Implementation steps (after approval)

**Phase 0, spikes (go/no-go, 2–3 days)** via `apps/cli`, results recorded in `docs/adr/`:
1. `spike:tts` — deploy `infra/runpod/voxcpm2`, clone from a 25 s licensed pt-PT reference clip, synthesise the 20 accent shibboleth sentences, run Whisper + audio judge, two native listeners rate blind. Go if European confidence ≥ 90% on ≥ 18/20. No-go switches the default `TTSProvider` to `elevenlabs` and keeps VoxCPM2 as an experiment.
2. `spike:amalia` — deploy `infra/runpod/amalia` (worker-v1-vllm, A40), run the 30 editor cases through the editing prompt at greedy and T=0.2, measure cold start, p50, edit rate, fact-diff failures, fix rate. Also try AWQ int4 on L4 for cost.
3. `spike:sources` — one Parse.bot Imovirtual search + detail, one Piloterr `idealista.pt` search + property; confirm fields and `.pt` support. Casafari sandbox call as soon as the key arrives.
4. `spike:gemini-compat` — confirm `response_format: json_schema`, `seed` and `reasoning_effort` on Google's OpenAI-compat endpoint and on the Lovable gateway; set adapter capability flags.

**Phase 1, scaffold (1 day)**: pnpm monorepo, turbo, strict tsconfig, ESLint flat config, vitest, `.env.example`, `.github/workflows/ci.yml`, `supabase init`, `docker-compose.dev.yml`. Verify: `pnpm lint && pnpm typecheck && pnpm test` green in CI.

**Phase 2, core + db (2 days)**: schemas in `packages/core`, feature taxonomy, config loader, pricing table, Drizzle schema and first migration for every table in the diagram with `tenant_role`, `has_tenant_role()` and RLS. Verify: migration applies locally and on a Supabase branch; RLS smoke as `authenticated`.

**Phase 3, llm + generator (2 days)**: port `openaiWireClient` and `sse`, four adapters with capability flags, `generator.ts`, prompt file, `completeJson` with one repair, pre-validator. Verify: msw contract tests (200/429/402/500/timeout/length); 10 golden listings produce valid `GenerationResult`; injected invented numbers are caught.

**Phase 4, ptpt-qa (3 days)**: lexicon v1 (150 rows) with a precision suite on the must-not-flag list, `factDiff`, `grammarPatterns`, `editRatio`, `shape`, `claimsCheck`, `judge`, `gate/decide` decision table, golden set v0 (20 listings + 15 editor cases, growing to 50 + 30 with a native reviewer). Verify: unit tests; judge separates 5 pt-BR from 5 pt-PT samples by ≥ 20 points; `pnpm eval:golden` runs.

**Phase 5, AMALIA editor + gate worker (2 days)**: `amaliaEditor.ts`, retry ladder, `review_queue` writes, `gate.editor` config, RunPod endpoint config committed. Verify: fixture listing goes `generated → gated_pass`; a seeded pt-BR text goes to `review_queue` after the ladder; editor cases ≥ 90% fixed with zero fact changes.

**Phase 6, tts (4 days)**: pt-PT normaliser with tests (`dezasseis`, `dezanove`, money, m², typology, ordinals, abbreviations), chunker, `voxcpm2-runpod` adapter and `handler.py`, ffmpeg post, `tts_cache`, `accentQa.ts`, `elevenlabs` adapter. Verify: fixture `narracao` → mp3 + wav at −16 ±1 LUFS with correct duration; accent eval runs.

**Phase 7, ingestion (3 days)**: `csv-feed`, `xml-feed`, `imovirtual-parsebot`, `casafari` (against the sandbox once the key exists, otherwise a recorded-fixture stub), normalisers, PII policy, dedup, rate limiter, breaker, `ingest_runs` cursors. Verify: contract tests; import of a 50-row CSV creates 50 listings and 50 jobs; re-import creates none; a killed run resumes from its cursor.

**Phase 8, worker + api (3 days)**: pg-boss queues, state machine, idempotency, dead-letter handler, cost ledger, Fastify routes, API keys, webhooks with HMAC. Verify: fake-adapter state machine tests; end-to-end smoke `pnpm cli run <listingId>` publishes text + audio; `GET /listings/:id/outputs` returns signed URLs; a local receiver verifies the webhook signature.

**Phase 9, ops + docs (2 days)**: OTel spans per step, metrics, Grafana board, budgets, runbooks, `docs/architecture.md`, `docs/legal.md`, `docs/review-checklist.md`, README. Verify: a 100-listing load run completes with gate pass rate and cost per listing reported and matching the ledger.

**Phase 10, MVP deploy and pilot**: Cloud Run api + worker, Secret Manager, buckets, RunPod endpoints with FlashBoot and network volumes, 50-listing pilot for one agency from its CSV. Verify: p50 < 90 s warm, gate pass ≥ 85%, native review ≥ 4/5 on 20 samples.

## Verification (end to end)

- `pnpm test` covers normaliser, lexicon precision and recall, factDiff, grammar patterns, editRatio, decide table, chunker, dedup, PII policy, adapters with recorded fixtures.
- `pnpm eval:golden` ≥ 92 mean judge score, min ≥ 85, zero block hits, 100% fact pass, ≥ 95% injected errors fixed.
- `pnpm eval:accent` ≥ 18/20 European on the shibboleth set, WER < 8%.
- Smoke: import one real owned listing by CSV, run the job, open the mp3, read the JSON, confirm the stored diff between Gemini and AMALIA output.
- Native-speaker checklist (`docs/review-checklist.md`: registo, brasileirismos, tipologia, ortografia AO90, clíticos, números no áudio, sotaque, topónimos, ritmo, CTA) on 20 outputs by two reviewers before the first tenant goes live.
