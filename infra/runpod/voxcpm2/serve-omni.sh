#!/usr/bin/env bash
# Production alternative to the serverless worker: VoxCPM2 under vLLM-Omni on a RunPod Pod,
# kept warm so requests batch instead of cold-starting. Exposes an OpenAI-audio-compatible
# POST /v1/audio/speech, consumed by `voxcpm2-http` (packages/tts/src/adapters/voxcpm2Http.ts).
#
# Needs >= 24 GB VRAM (L4 or better) kept resident; RTF ~0.12 with batching, versus ~0.30 for
# the plain `voxcpm` library call the serverless worker (`handler.py`) makes per request.
#
# Run on a RunPod Pod (or any box with a CUDA GPU): a base image with CUDA + Python 3.11,
# `pip install vllm`, then this script. `HF_HOME` should point at a persistent volume so the
# ~2B-parameter weights are not re-downloaded on every Pod restart.
set -euo pipefail

: "${VOXCPM_MODEL:=openbmb/VoxCPM2}"
: "${HOST:=0.0.0.0}"
: "${PORT:=8000}"
: "${HF_HOME:=/runpod-volume/hf}"

export HF_HOME

echo "[serve-omni] serving ${VOXCPM_MODEL} on ${HOST}:${PORT} (HF_HOME=${HF_HOME})"
exec vllm serve "${VOXCPM_MODEL}" --omni --host "${HOST}" --port "${PORT}"
