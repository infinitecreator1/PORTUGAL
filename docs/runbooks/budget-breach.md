# Runbook: tenant budget breach

**Symptom.** Jobs held in `queued` with warning `budget`; alert "cost per listing > 2× 7-day baseline" or the tenant's monthly hard limit reached.

**Checks.**
1. `SELECT provider, step, sum(cost_usd) FROM cost_events WHERE tenant_id = $1 AND created_at >= date_trunc('month', now()) GROUP BY 1,2;`
2. Retry storms: many `gate_reports` per job (`loop`/`attempt` high) mean the gate is looping. Follow `gate-failures.md`.
3. Thinking tokens: `reasoning_tokens` in generation usage should be small with `reasoning_effort: low`. A spike means the model changed.
4. GPU idle: RunPod `idleTimeoutSeconds` too high or `workersMin` left at 1 after a pilot.

**Fix.**
- Raise the soft/hard limit in `tenant_budgets` for the month if the volume is legitimate.
- Switch the tenant's generation profile to `gemini-2.5-flash` for bulk backfills.
- Lower `idleTimeoutSeconds` to 60 outside business hours.
