# VoxCPM2 on RunPod Serverless. ffmpeg is only needed here for faster-whisper's audio
# decoding path; the pipeline's own ffmpeg post (loudnorm, MP3) runs in apps/worker, not here.
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir voxcpm runpod soundfile faster-whisper

# Hugging Face cache on the network volume so a fresh worker does not re-download the
# ~2B-parameter VoxCPM2 weights (or the Whisper large-v3 weights on first accent-QA call).
ENV HF_HOME=/runpod-volume/hf
ENV VOXCPM_MODEL=openbmb/VoxCPM2
ENV WHISPER_MODEL=large-v3
ENV PYTHONUNBUFFERED=1

WORKDIR /app
COPY handler.py .

CMD ["python", "-u", "handler.py"]
