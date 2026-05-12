# Docker Codex OCR Server

The offline Docker image defaults to the `codex` OCR profile. With no profile argument, it starts:

```bash
lit codex-ocr-server \
  --host 0.0.0.0 \
  --port "${LITEPARSE_CODEX_OCR_PORT:-8833}" \
  --codex-home "${LITEPARSE_CODEX_HOME:-/codex-home}"
```

This server implements the LiteParse `POST /ocr` multipart contract and exposes `POST /ocr/analyze` for richer Codex page-understanding artifacts.

## Codex Home

`codex-ocr-server` needs a usable Codex home directory. Mount it into the container and set `LITEPARSE_CODEX_HOME`:

```bash
docker run --rm -p 8833:8833 \
  -e LITEPARSE_CODEX_HOME=/codex-home \
  -v "$HOME/.codex:/codex-home" \
  liteparse-glmocr-vllm-offline:1.5.3-custom.1
```

The mounted directory may contain `auth.json` for ChatGPT or API-key Codex auth, `config.toml`, or both. Treat `auth.json` as a secret because it contains access tokens.

## Local or Proxy Model Providers

For a local Open Responses-compatible endpoint, mount a Codex config such as `config.local-open-responses.example.toml` to `/codex-home/config.toml`:

```bash
docker run --rm -p 8833:8833 \
  -e LITEPARSE_CODEX_HOME=/codex-home \
  -v "$PWD/docker/codex-ocr-server/config.local-open-responses.example.toml:/codex-home/config.toml:ro" \
  liteparse-glmocr-vllm-offline:1.5.3-custom.1
```

Codex custom providers are defined under `model_providers.<id>` and selected with `model_provider = "<id>"`. Current OpenAI Codex configuration schema documents `wire_api = "responses"` for custom providers. If you only have an OpenAI Chat Completions-compatible endpoint, put a local adapter or proxy in front of it that exposes a Responses/Open Responses-compatible API before using it as the Codex provider, unless your pinned Codex version documents another supported `wire_api`.

Relevant references:

- `https://developers.openai.com/codex/config-advanced#custom-model-providers`
- `https://developers.openai.com/codex/auth#alternative-model-providers`
- `https://developers.openai.com/codex/config-reference`
- `https://developers.openai.com/codex/config-schema.json`
- `https://developers.openai.com/api/reference/responses/overview`
- `https://ai-sdk.dev/providers/ai-sdk-providers/open-responses`

## Alternate GLM-OCR vLLM Profile

The GLM-OCR vLLM server remains available explicitly:

```bash
docker run --rm --gpus all --ipc=host -p 8831:8831 \
  -e LITEPARSE_OCR_PROFILE=glmocr-vllm \
  liteparse-glmocr-vllm-offline:1.5.3-custom.1
```

Use `smoke` for the GPU vLLM image smoke:

```bash
docker run --rm --gpus all --ipc=host --network=none \
  liteparse-glmocr-vllm-offline:1.5.3-custom.1 smoke
```
