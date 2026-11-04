# Basira scorer (task A6). Build from the REPO ROOT (it needs contracts/):
#   docker build -f ai/Dockerfile -t basira-scorer .
# Both acoustic models are downloaded at build time, so a cold start never fetches 2.5 GB.
# Local development and the fallback host (docs/DECISIONS.md); the free hosted scorer is a Gradio Space instead.
# CI builds and tests this image: .github/workflows/scorer-image.yml.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf \
    BASIRA_CONTRACTS_DIR=/app/contracts \
    PORT=8000

# CPU-only PyTorch first, so the [model] extra does not pull the multi-GB CUDA build
RUN pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu

WORKDIR /app
COPY ai/pyproject.toml ai/
COPY ai/basira_ai ai/basira_ai
COPY ai/service ai/service
COPY contracts contracts
RUN pip install "./ai[model,service]"

RUN python -c "from huggingface_hub import snapshot_download as d; \
[d(m, allow_patterns=['*.json', '*.bin', '*.safetensors', '*.txt']) for m in \
('facebook/wav2vec2-xlsr-53-espeak-cv-ft', 'jonatasgrosman/wav2vec2-large-xlsr-53-arabic')]"

ENV HF_HUB_OFFLINE=1
RUN useradd --create-home basira
USER basira
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/health' % __import__('os').environ['PORT']).status == 200 else 1)"
CMD ["sh", "-c", "uvicorn service.app:build --factory --host 0.0.0.0 --port ${PORT}"]
