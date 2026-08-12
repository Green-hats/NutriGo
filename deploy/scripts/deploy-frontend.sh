#!/usr/bin/env bash
# ============================================================
# NutriGo — 部署前端到前端节点
# 功能: 先本地构建，再 scp dist 到前端节点，并 reload Caddy
# 用法: bash deploy/scripts/deploy-frontend.sh
# 需先配置下方变量（或用环境变量覆盖）
# ============================================================
set -euo pipefail

# ---- 配置（改成你的前端节点）----
HK_USER="${HK_USER:-root}"
HK_HOST="${HK_HOST:-你的前端节点IP}"
HK_SSH_PORT="${HK_SSH_PORT:-22}"
HK_REMOTE_DIR="${HK_REMOTE_DIR:-/srv/nutrigo}"
CADDY_SERVICE="${CADDY_SERVICE:-caddy}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="${ROOT}/deploy/dist"

log() { printf '\033[32m[deploy-frontend]\033[0m %s\n' "$*"; }

if [[ "${HK_HOST}" == *"你的前端节点IP"* ]]; then
  echo "请先编辑 deploy/scripts/deploy-frontend.sh 配置 HK_HOST（前端节点 IP）" >&2
  exit 1
fi

# 1) 构建
bash "${ROOT}/deploy/scripts/build-frontend.sh"

# 2) 上传
log "scp ${DIST} → ${HK_USER}@${HK_HOST}:${HK_REMOTE_DIR}"
ssh -p "${HK_SSH_PORT}" "${HK_USER}@${HK_HOST}" "mkdir -p ${HK_REMOTE_DIR}"
scp -P "${HK_SSH_PORT}" -r "${DIST}/"* "${HK_USER}@${HK_HOST}:${HK_REMOTE_DIR}/"

# 3) reload Caddy（如 Caddyfile 有变更）
log "reload Caddy..."
ssh -p "${HK_SSH_PORT}" "${HK_USER}@${HK_HOST}" \
  "systemctl reload ${CADDY_SERVICE} 2>/dev/null || caddy reload 2>/dev/null || true"

log "✅ 部署完成: <your-domain>"
