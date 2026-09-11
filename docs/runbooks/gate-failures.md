# Runbook: gate pass rate drops

**Symptom.** `gate_decisions_total{decision="needs_review"}` climbs; alert "gate pass rate < 80% over 1 h".

**Triage in order.**
1. **Which validator fails?** `GET /v1/jobs/:id` shows the gate report per attempt. Group the last 50 reports by failing validator name.
2. **`facts` failing** → the editor is rewriting numbers or places. Check the AMALIA endpoint model name and temperature (must be 0.2). If a new model version was deployed, run `pnpm eval:golden` against it and roll back if it regresses.
3. **`lexicon` failing after edit** → the editor is not fixing a term. Add the term to the strict-retry hints (it already is, by construction) and, if AMALIA still ignores it, set `GATE_EDITOR=gemini` for the tenant while you investigate.
4. **`judge` below 90 with clean validators** → the judge model changed or the prompt drifted. Compare judge scores on `evals/golden/listings` between the previous and current model.
5. **`shape` failing** → generation lengths changed. Check the generation profile `target_length` and the Gemini model.
6. **Everything failing at once** → the editor returns garbage (cold-start truncation, `finish_reason=length`). Look at `editor_output_tokens` in the reports and the RunPod logs.

**Clearing the review queue.** `pnpm cli review list`, then `pnpm cli review approve <id>` (optionally with an edited JSON) or `reject <id>`. Approving triggers narration.

**Feed the lexicon.** Every genuine pt-BR term that reached review goes into `packages/ptpt-qa/src/lexicon/markers.ts` with a test example.
