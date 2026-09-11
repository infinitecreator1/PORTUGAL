"""RunPod Serverless handler for VoxCPM2 (pt-PT narration) plus a lazy Whisper transcriber
used for accent QA.

Request contract (`event["input"]`), matching `packages/tts/src/adapters/voxcpm2Runpod.ts`:

    {"op": "tts", "text": "...", "reference_audio_b64": "<base64 wav>"?,
     "reference_transcript": "..."?, "cfg_value": 2.0, "inference_timesteps": 10,
     "seed": 42, "speaking_rate": 1.0, "sample_rate": 48000}
    -> {"audio_b64": "<base64 wav>", "sample_rate": 48000, "gpu_seconds": 0.7, "format": "wav"}

    {"op": "transcribe", "audio_b64": "<base64 wav>"}
    -> {"text": "..."}

Any exception is reported as `{"error": "..."}`, which RunPod records as a FAILED job with
that string in the job's `error` field.
"""

import base64
import hashlib
import os
import tempfile
import time
import traceback

import runpod
import soundfile as sf

MODEL_ID = os.environ.get("VOXCPM_MODEL", "openbmb/VoxCPM2")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3")

# Network volume when attached (production), /tmp otherwise (local dev, or no volume).
_NETWORK_VOLUME = "/runpod-volume"
REFS_DIR = os.path.join(_NETWORK_VOLUME, "refs") if os.path.isdir(_NETWORK_VOLUME) else "/tmp/voxcpm2-refs"

_model = None
_whisper = None


def _get_model():
    """Loads VoxCPM once per worker process; `load_denoiser=False` since inputs are already clean."""
    global _model
    if _model is None:
        from voxcpm import VoxCPM

        print(f"[voxcpm2] loading {MODEL_ID} ...", flush=True)
        _model = VoxCPM.from_pretrained(MODEL_ID, load_denoiser=False)
        print("[voxcpm2] model ready", flush=True)
    return _model


def _get_whisper():
    """Loads faster-whisper lazily: most workers only ever do TTS, never accent QA."""
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        print(f"[voxcpm2] loading faster-whisper {WHISPER_MODEL} ...", flush=True)
        _whisper = WhisperModel(WHISPER_MODEL)
        print("[voxcpm2] whisper ready", flush=True)
    return _whisper


def _cache_reference_audio(reference_audio_b64: str) -> str:
    """Caches the decoded reference WAV by content hash so the same tenant voice is decoded
    and written to disk only once across requests, ideally on the persistent network volume."""
    os.makedirs(REFS_DIR, exist_ok=True)
    raw = base64.b64decode(reference_audio_b64)
    digest = hashlib.sha256(raw).hexdigest()
    path = os.path.join(REFS_DIR, f"{digest}.wav")
    if not os.path.exists(path):
        tmp_path = f"{path}.tmp-{os.getpid()}"
        with open(tmp_path, "wb") as f:
            f.write(raw)
        os.replace(tmp_path, path)
    return path


def _handle_tts(job_input: dict) -> dict:
    model = _get_model()

    text = job_input["text"]
    reference_audio_b64 = job_input.get("reference_audio_b64")
    reference_wav_path = _cache_reference_audio(reference_audio_b64) if reference_audio_b64 else None
    reference_transcript = job_input.get("reference_transcript") or None

    cfg_value = job_input.get("cfg_value", 2.0)
    inference_timesteps = job_input.get("inference_timesteps", 10)
    seed = job_input.get("seed", 42)
    # `speaking_rate` has no VoxCPM2 generation-time equivalent yet (verified Sept 2026); the
    # style prefix baked into `text` by the caller is the only rate/tone control available.

    started = time.monotonic()
    wav = model.generate(
        text=text,
        reference_wav_path=reference_wav_path,
        prompt_wav_path=reference_wav_path,
        prompt_text=reference_transcript,
        cfg_value=cfg_value,
        inference_timesteps=inference_timesteps,
        seed=seed,
    )
    gpu_seconds = round(time.monotonic() - started, 3)

    sample_rate = model.tts_model.sample_rate
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, wav, sample_rate, subtype="PCM_16")
        tmp.seek(0)
        audio_bytes = tmp.read()

    return {
        "audio_b64": base64.b64encode(audio_bytes).decode("ascii"),
        "sample_rate": sample_rate,
        "gpu_seconds": gpu_seconds,
        "format": "wav",
    }


def _handle_transcribe(job_input: dict) -> dict:
    whisper = _get_whisper()
    raw = base64.b64decode(job_input["audio_b64"])
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(raw)
        tmp.flush()
        segments, _info = whisper.transcribe(tmp.name, language="pt")
        text = "".join(segment.text for segment in segments).strip()
    return {"text": text}


def handler(job: dict) -> dict:
    job_input = job.get("input") or {}
    op = job_input.get("op", "tts")
    try:
        if op == "tts":
            return _handle_tts(job_input)
        if op == "transcribe":
            return _handle_transcribe(job_input)
        return {"error": f"unknown op '{op}'"}
    except Exception as exc:  # report every failure to the caller instead of crashing the worker
        traceback.print_exc()
        return {"error": f"{type(exc).__name__}: {exc}"}


runpod.serverless.start({"handler": handler})
