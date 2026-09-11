# Evals

Regression material for the language gate and the voice. Grow these sets with a native reviewer; the shapes are fixed so the runners in `apps/cli` keep working.

## golden/listings/<id>.json

```json
{
  "id": "lisboa-campo-ourique-t3",
  "listing": { …ListingInput (see packages/core/src/schemas/listing.ts)… },
  "reference": { …GenerationResult written by a native copywriter, or null… },
  "notes": "what makes this case interesting"
}
```

`pnpm eval:golden` generates copy for each listing, runs the gate and reports mean and minimum judge score, block lexicon hits per 1k words, fact-diff pass rate, edit ratio distribution, cost and latency. Thresholds (CI on prompt/model changes): mean ≥ 92, min ≥ 85, zero block hits, 100% fact pass.

`golden/listings/sample.csv` is the same listings in the CSV feed format for `pnpm cli import-csv`.

## golden/editor/<id>.json

```json
{
  "id": "banheiro-terreo",
  "field": "descricao",
  "input": "text with injected Brazilianisms",
  "expected_fixes": [{ "from": "banheiro", "to": "casa de banho" }],
  "protected_facts": ["118 m²", "745 000 €", "T3"]
}
```

The editor eval sends `input` through the configured editor and checks that every `from` disappears, every `protected_facts` string survives, and the fact diff is clean. Threshold: ≥ 95% of fixes applied, zero fact changes.

## accent/sentences.json

Twenty pt-PT sentences loaded with European shibboleths (dezasseis, dezanove, autocarro, pequeno-almoço, rés-do-chão, place names). `pnpm eval:accent` synthesises each with the configured voice, transcribes it, computes WER and asks the audio judge whether the accent is European. Threshold: ≥ 18/20 European with WER < 8%.
