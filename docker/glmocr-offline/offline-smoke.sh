#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d /opt/models/glm-ocr ]]; then
  echo "Missing /opt/models/glm-ocr" >&2
  exit 1
fi

if [[ ! -d /opt/models/pp-doclayout ]]; then
  echo "Missing /opt/models/pp-doclayout" >&2
  exit 1
fi

if [[ ! -d "${LITEPARSE_GLMOCR_ROOT:-/opt/glm-ocr-sdk}" ]]; then
  echo "Missing GLM-OCR SDK root: ${LITEPARSE_GLMOCR_ROOT:-/opt/glm-ocr-sdk}" >&2
  exit 1
fi

if [[ "${HF_HUB_OFFLINE:-}" != "1" || "${TRANSFORMERS_OFFLINE:-}" != "1" ]]; then
  echo "Offline smoke expects HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1" >&2
  exit 1
fi

lit --version

workdir="$(mktemp -d)"
server_pid=""
cleanup() {
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" >/dev/null 2>&1; then
    kill "${server_pid}" >/dev/null 2>&1 || true
    wait "${server_pid}" >/dev/null 2>&1 || true
  fi
  rm -rf "${workdir}"
}
trap cleanup EXIT INT TERM

python3 - <<'PY' "${workdir}/blank.png"
import base64
import pathlib
import sys

png = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0l"
    "EQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)
pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(png))
PY

/usr/local/bin/glmocr-offline-entrypoint glmocr-vllm >"${workdir}/server.log" 2>&1 &
server_pid="$!"

started_at="$(date +%s)"
until curl -fsS "http://127.0.0.1:${LITEPARSE_GLMOCR_PORT:-8831}/health" | jq . >/dev/null; do
  if ! kill -0 "${server_pid}" >/dev/null 2>&1; then
    echo "Offline GLM-OCR server exited before health was ready" >&2
    tail -200 "${workdir}/server.log" >&2 || true
    exit 1
  fi
  if (( "$(date +%s)" - started_at >= "${LITEPARSE_OFFLINE_SMOKE_TIMEOUT_SECONDS:-1200}" )); then
    echo "Timed out waiting for offline GLM-OCR health endpoint" >&2
    tail -200 "${workdir}/server.log" >&2 || true
    exit 1
  fi
  sleep 2
done

curl -fsS -X POST "http://127.0.0.1:${LITEPARSE_GLMOCR_PORT:-8831}/ocr" \
  -F "file=@${workdir}/blank.png" \
  -F "language=en" \
| jq -e '.results | arrays' >/dev/null

echo "offline-smoke-ok"
