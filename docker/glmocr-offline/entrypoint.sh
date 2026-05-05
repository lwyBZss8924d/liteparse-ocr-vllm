#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "bash" || "${1:-}" == "sh" || "${1:-}" == "lit" || "${1:-}" == "liteparse" || "${1:-}" == "codex" ]]; then
  exec "$@"
fi

profile="${1:-${LITEPARSE_OCR_PROFILE:-glmocr-vllm}}"
if [[ $# -gt 0 && "${1:-}" == "${profile}" ]]; then
  shift
fi

vllm_pid=""
cleanup() {
  if [[ -n "${vllm_pid}" ]] && kill -0 "${vllm_pid}" >/dev/null 2>&1; then
    kill "${vllm_pid}" >/dev/null 2>&1 || true
    wait "${vllm_pid}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

wait_for_http() {
  local url="$1"
  local timeout_seconds="$2"
  local started_at
  started_at="$(date +%s)"
  until curl -fsS "${url}" >/dev/null; do
    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      echo "Timed out waiting for ${url}" >&2
      return 1
    fi
    sleep 2
  done
}

case "${profile}" in
  glmocr-vllm|server)
    served_model_name="${LITEPARSE_GLMOCR_MODEL:-glm-ocr}"
    vllm_port="${LITEPARSE_VLLM_PORT:-8000}"
    vllm_model_dir="${LITEPARSE_GLMOCR_MODEL_DIR:-/opt/models/glm-ocr}"
    layout_model_dir="${LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR:-/opt/models/pp-doclayout}"
    glmocr_port="${LITEPARSE_GLMOCR_PORT:-8831}"
    glmocr_python="${LITEPARSE_GLMOCR_PYTHON:-/opt/liteparse-glmocr-venv/bin/python}"
    layout_device="${LITEPARSE_GLMOCR_LAYOUT_DEVICE:-cuda}"
    vllm_speculative_config="${LITEPARSE_VLLM_SPECULATIVE_CONFIG:-{\"method\":\"mtp\",\"num_speculative_tokens\":3}}"

    vllm serve "${vllm_model_dir}" \
      --host 0.0.0.0 \
      --port "${vllm_port}" \
      --served-model-name "${served_model_name}" \
      --speculative-config "${vllm_speculative_config}" \
      ${LITEPARSE_VLLM_EXTRA_ARGS:-} &
    vllm_pid="$!"

    wait_for_http "http://127.0.0.1:${vllm_port}/v1/models" "${LITEPARSE_VLLM_STARTUP_TIMEOUT_SECONDS:-900}"

    exec lit glmocr-ocr-server \
      --model-runtime openai-compatible \
      --ocr-api-url "http://127.0.0.1:${vllm_port}/v1/chat/completions" \
      --model "${served_model_name}" \
      --glmocr-root "${LITEPARSE_GLMOCR_ROOT:-/opt/glm-ocr-sdk}" \
      --glmocr-python "${glmocr_python}" \
      --layout-model-dir "${layout_model_dir}" \
      --layout-device "${layout_device}" \
      --host 0.0.0.0 \
      --port "${glmocr_port}" \
      "$@"
    ;;
  codex)
    codex_args=(
      lit codex-ocr-server
      --backend "${LITEPARSE_CODEX_OCR_BACKEND:-sdk}"
      --host 0.0.0.0 \
      --port "${LITEPARSE_CODEX_OCR_PORT:-8833}" \
      --codex-home "${LITEPARSE_CODEX_HOME:-${CODEX_HOME:-/codex-home}}" \
      --model "${LITEPARSE_CODEX_OCR_MODEL:-gpt-5.5}" \
      --reasoning-effort "${LITEPARSE_CODEX_OCR_REASONING:-medium}" \
      --timeout-ms "${LITEPARSE_CODEX_OCR_TIMEOUT_MS:-300000}"
    )
    if [[ "${LITEPARSE_CODEX_OCR_INCLUDE_RAW:-}" == "1" || "${LITEPARSE_CODEX_OCR_INCLUDE_RAW:-}" == "true" ]]; then
      codex_args+=(--include-raw)
    fi
    if [[ "${LITEPARSE_CODEX_OCR_STRICT_BBOX:-}" == "1" || "${LITEPARSE_CODEX_OCR_STRICT_BBOX:-}" == "true" ]]; then
      codex_args+=(--strict-bbox)
    fi
    exec "${codex_args[@]}" "$@"
    ;;
  smoke)
    exec /usr/local/bin/glmocr-offline-smoke "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
