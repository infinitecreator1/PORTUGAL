# Runbook: listing source outage or schema drift

**Symptom.** `ingest_runs.status = failed` twice in a row for a source; circuit breaker open; `provider_errors_total{provider="imovirtual-parsebot"}` rising; or many `ValidationError: cannot map` skips.

**Transport failures (429/5xx/timeouts).**
1. Check the provider status page and your credit balance (Parse.bot, Piloterr) or contract state (Casafari).
2. The breaker opens after 5 consecutive failures and half-opens after 10 minutes; runs resume from the persisted cursor automatically on the next schedule.
3. Lower the saved search `rpm`/`max_pages` if the provider tier changed.

**Schema drift (normalisation skips).**
1. Fetch one raw payload (`raw_ref` in storage) and diff it against `packages/ingestion/test/fixtures/<adapter>/`.
2. Update the adapter's `normalize()` and the fixture, add a test, ship.
3. Re-run the ingestion for the affected saved search; unchanged listings are de-duplicated by `content_hash`, so re-runs are safe.

**Fallback.** Owned inventory can always be imported from the agency's CSV/XML feed (`pnpm cli import-csv`) while a wrapper is down. Third-party sources are analytics only and never block copy generation.
