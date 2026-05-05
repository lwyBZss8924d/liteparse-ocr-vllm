#!/usr/bin/env bash
set -euo pipefail

image="${LITEPARSE_OFFLINE_IMAGE:-liteparse-glmocr-vllm-offline:1.5.3-custom.0}"
tar_path="${1:-${LITEPARSE_OFFLINE_IMAGE_TAR:-}}"
default_tar=".tmp/release/docker/liteparse-glmocr-vllm-offline-1.5.3-custom.0-linux-amd64.tar"
if [[ -z "${tar_path}" && -f "${default_tar}" ]]; then
  tar_path="${default_tar}"
fi

timeout_seconds="${LITEPARSE_OFFLINE_SMOKE_TIMEOUT_SECONDS:-1200}"
port="${LITEPARSE_GLMOCR_PORT:-8831}"
container_name="liteparse-glmocr-vllm-e2e-$$"

log() {
  printf '[liteparse-gpu-smoke] %s\n' "$*"
}

fail() {
  printf '[liteparse-gpu-smoke] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

docker_env_args=()
for env_name in \
  LITEPARSE_VLLM_EXTRA_ARGS \
  LITEPARSE_VLLM_SPECULATIVE_CONFIG \
  LITEPARSE_VLLM_STARTUP_TIMEOUT_SECONDS \
  LITEPARSE_OFFLINE_SMOKE_TIMEOUT_SECONDS \
  LITEPARSE_GLMOCR_LAYOUT_DEVICE \
  LITEPARSE_GLMOCR_PORT
do
  if [[ -n "${!env_name:-}" ]]; then
    docker_env_args+=(-e "${env_name}=${!env_name}")
  fi
done

cleanup() {
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

require_cmd docker
require_cmd jq

if [[ -n "${tar_path}" ]]; then
  [[ -f "${tar_path}" ]] || fail "image tar not found: ${tar_path}"
  log "loading image archive: ${tar_path}"
  docker load -i "${tar_path}"
fi

log "inspecting image: ${image}"
platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "${image}")"
[[ "${platform}" == "linux/amd64" ]] || fail "expected linux/amd64 image, got ${platform}"

env_lines="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${image}")"
for required_env in \
  "HF_HUB_OFFLINE=1" \
  "TRANSFORMERS_OFFLINE=1" \
  "LITEPARSE_GLMOCR_ROOT=/opt/glm-ocr-sdk" \
  "LITEPARSE_GLMOCR_LAYOUT_MODEL_DIR=/opt/models/pp-doclayout"
do
  grep -Fx "${required_env}" <<<"${env_lines}" >/dev/null || fail "image missing env: ${required_env}"
done

log "checking Docker GPU runtime availability"
if ! docker run --rm --gpus all --network=none "${image}" lit --version; then
  fail "Docker GPU runtime is unavailable on this host. Re-run on a Linux x64 NVIDIA GPU host."
fi

log "running in-image offline smoke under --network=none"
docker run --rm \
  --gpus all \
  --ipc=host \
  --network=none \
  "${docker_env_args[@]}" \
  "${image}" smoke

log "starting glmocr-vllm profile under --network=none for docker exec loopback checks"
docker run -d \
  --name "${container_name}" \
  --gpus all \
  --ipc=host \
  --network=none \
  -e LITEPARSE_OCR_PROFILE=glmocr-vllm \
  "${docker_env_args[@]}" \
  "${image}" >/dev/null

started_at="$(date +%s)"
until docker exec "${container_name}" curl -fsS "http://127.0.0.1:${port}/health" | jq . >/dev/null; do
  if ! docker ps --format '{{.Names}}' | grep -Fx "${container_name}" >/dev/null; then
    docker logs --tail 200 "${container_name}" >&2 || true
    fail "container exited before health endpoint was ready"
  fi
  if (( "$(date +%s)" - started_at >= timeout_seconds )); then
    docker logs --tail 200 "${container_name}" >&2 || true
    fail "timed out waiting for /health after ${timeout_seconds}s"
  fi
  sleep 2
done

log "health endpoint is ready"
docker exec "${container_name}" curl -fsS "http://127.0.0.1:${port}/health" | jq .

log "creating OCR smoke image and sample PDF inside the container"
docker exec "${container_name}" /opt/liteparse-glmocr-venv/bin/python - <<'PY'
from pathlib import Path
from PIL import Image, ImageDraw

img = Image.new("RGB", (360, 180), "white")
draw = ImageDraw.Draw(img)
draw.text((24, 70), "LiteParse OCR Table A: 42", fill="black")
img.save("/tmp/liteparse-ocr-smoke.png")

objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 45 >>\nstream\nBT /F1 18 Tf 24 50 Td (Hello LiteParse) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
pdf = "%PDF-1.4\n"
offsets = [0]
for idx, obj in enumerate(objects, start=1):
    offsets.append(len(pdf.encode("latin1")))
    pdf += f"{idx} 0 obj\n{obj}\nendobj\n"
xref_offset = len(pdf.encode("latin1"))
pdf += f"xref\n0 {len(objects) + 1}\n"
pdf += "0000000000 65535 f \n"
for offset in offsets[1:]:
    pdf += f"{offset:010d} 00000 n \n"
pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
Path("/tmp/liteparse-smoke.pdf").write_bytes(pdf.encode("latin1"))
PY

log "validating LiteParse-compatible POST /ocr contract"
docker exec "${container_name}" sh -lc \
  "curl -fsS -X POST 'http://127.0.0.1:${port}/ocr' \
    -F 'file=@/tmp/liteparse-ocr-smoke.png' \
    -F 'language=en' \
  | tee /tmp/liteparse-ocr-response.json \
  | jq -e '.results | arrays' >/dev/null"

log "validating lit parse against the in-container OCR server"
docker exec "${container_name}" sh -lc \
  "lit parse /tmp/liteparse-smoke.pdf \
    --ocr-server-url 'http://127.0.0.1:${port}/ocr' \
    --format json \
  | tee /tmp/liteparse-parse-response.json \
  | jq -e '.pages == 1 and (.text | contains(\"Hello LiteParse\"))' >/dev/null"

log "gpu offline validation passed"
