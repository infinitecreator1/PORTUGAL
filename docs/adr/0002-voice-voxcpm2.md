# ADR 0002: VoxCPM2 with a cloned European Portuguese voice

**Status.** Accepted pending the Phase 0 accent spike.

**Context.** Verified September 2026: Gemini API TTS lists only "Portuguese" without a pt-PT locale; Google Cloud Gemini-TTS has pt-PT in preview; Chirp 3 HD and the classic Cloud TTS voices have no pt-PT; ElevenLabs and Azure ship pt-PT voices. VoxCPM2 (OpenBMB, Apache-2.0, 2B) supports Portuguese without a variant flag, clones a voice from a short clip and renders 48 kHz audio at RTF 0.12–0.30 on a 24 GB GPU.

**Decision.** VoxCPM2 self-hosted on RunPod is the default `TTSProvider`. The European accent comes from "ultimate cloning" of a licensed pt-PT speaker (20–30 s clip plus exact transcript), a style prefix, and a fixed seed per profile. ElevenLabs and Gemini-TTS remain as adapters for A/B and failover.

**Go/no-go.** `pnpm cli spike tts` synthesises the 20 sentences in `evals/accent/sentences.json`; two native listeners rate them blind and the ASR/audio judge must reach ≥ 90% European on ≥ 18/20. A no-go flips `TTS_PROVIDER=elevenlabs`.

**Consequences.** Per-listing voice cost is about $0.004 on an L4. Voice rights need a signed consent per profile. Accent quality on unseen place names is monitored through accent QA and the pronunciation glossary.
