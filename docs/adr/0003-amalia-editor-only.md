# ADR 0003: AMALIA is an editor, not a generator

**Status.** Accepted.

**Context.** AMALIA-9B-0626-DPO scores 95.9 on the P3B3 pt-PT/pt-BR benchmark, far above general models, but has no published editing benchmark, no sampling guidance, and its model card warns about hallucination.

**Decision.** AMALIA receives plain text per section and returns plain text. It never sees the listing JSON and never generates. The pipeline computes the diff locally, then runs deterministic validators (fact diff, lexicon, grammar, edit ratio, shape, claims) and an independent Gemini judge. Sampling: temperature 0.2, top_p 0.9, repetition penalty 1.05, fixed seed. Failures follow a ladder: strict retry, regenerate with constraints, human review. If the editor golden set shows AMALIA fixing fewer than 90% of injected errors, `GATE_EDITOR=gemini` routes editing to a Gemini pt-PT prompt and AMALIA stays as a detector.

**Consequences.** The gate cannot invent facts undetected: any changed number, place or class is a hard fail. Cost per listing for the gate is about $0.002 on an A40. Quality of the gate is measurable by `pnpm eval:golden` and regression-tested in CI.
