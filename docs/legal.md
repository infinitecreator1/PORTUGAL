# Legal posture

This document records the data-handling rules the pipeline enforces in code. It is not legal advice; have counsel review it before the first paying tenant.

## Who owns what

- Listing descriptions and photos on Idealista, Imovirtual and other portals belong to the advertising agency. The portals' terms of use forbid scraping.
- Agent names, phone numbers and emails are personal data under the GDPR.
- Casafari data is licensed to the tenant under Casafari's terms; check redistribution clauses before exposing raw Casafari fields to end users.

## Ownership gate (enforced)

Every listing carries `ownership ∈ {owned, represented, third_party}`.

| Ownership | How it is set | What the pipeline does |
|---|---|---|
| `owned` | Feed rows from the tenant, or a portal/Casafari listing whose `agency_id` matches a `tenant_agencies` row | Full pipeline: copy, gate, voice, photos downloaded |
| `represented` | Set explicitly on import with a `consent_ref` pointing to the mandate or contract | Full pipeline |
| `third_party` | Default for anything else | Analytics only. Never generated, never voiced. Agent phone/email dropped at normalisation. Photo URLs kept, never downloaded. Raw payloads purged after 30 days. |

A tenant can only lift the third-party block with both `allow_third_party_generation = true` and a `legal_signoff_at` timestamp, and that combination is meant for benchmarking, not publishing.

## Personal data minimisation

- Agent contacts are stored only for `owned` and `represented` listings.
- Logs redact `phone`, `email`, `authorization` headers, API keys and secrets (see `packages/observability`).
- Prompts sent to Gemini and AMALIA contain the agency name but never phone numbers, emails or photo URLs.
- The voice reference clip is personal data of the speaker. A `voice_profiles.consent_doc_ref` is mandatory before a profile can synthesise, and every narration is stored with `ai_generated = true`, which the API returns so tenants can label the audio.

## Retention

| Data | Retention |
|---|---|
| Third-party raw payloads (`raw_ref`) | 30 days |
| Third-party `description_original` | 30 days, structured fields kept |
| Owned listings, versions, outputs | While the tenant is active, then 90 days |
| Cost events and job steps | 24 months (accounting) |
| Reference voice clips | Until the consent is withdrawn |

## Records of processing (GDPR art. 30) starter entries

1. Listing ingestion — purpose: preparing marketing copy for the tenant's own inventory; lawful basis: contract with the tenant; recipients: Google (Gemini), RunPod (AMALIA, VoxCPM2), Supabase.
2. Voice cloning — purpose: producing narrations in a licensed voice; lawful basis: consent of the speaker; recipient: RunPod.
3. Market analytics on third-party listings — purpose: benchmarking; lawful basis: legitimate interest; contacts not stored.

## Processors

Google Gemini API, RunPod (EU region where available), Supabase (EU project), Casafari, Parse.bot, Piloterr. Keep a signed DPA with each before production.
