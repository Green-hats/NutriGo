#!/usr/bin/env bash
# ============================================================
# NutriGo — 本地构建前端
# 功能: 在开发机执行 vite build，产物输出到 deploy/dist
# 用法: bash deploy/scripts/build-frontend.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ROOT}/deploy/dist"

log() { printf '\033[32m[build]\033[0m %s\n' "$*"; }

log "构建前端（React + Vite）..."
cd "${ROOT}/frontend"

if [[ ! -d node_modules ]]; then
  log "安装前端依赖..."
  npm install
fi

npm run build

log "清理旧产物并输出到 ${OUT}"
rm -rf "${OUT}"
mkdir -p "${OUT}"
cp -r "${ROOT}/frontend/dist/"* "${OUT}/"

log "✅ 构建完成: ${OUT}"
