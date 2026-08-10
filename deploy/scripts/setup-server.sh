#!/usr/bin/env bash
# ============================================================
# NutriGo — 国内 Debian 服务器初始化脚本
# 功能: 安装 Docker Engine + compose 插件、创建 4G swap
# 用法: sudo bash deploy/scripts/setup-server.sh
# ============================================================
set -euo pipefail

log() { printf '\033[32m[setup]\033[0m %s\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "请使用 sudo 运行: sudo bash $0" >&2
  exit 1
fi

# 1) 基础依赖
log "安装基础依赖..."
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git

# 2) Docker 官方源
log "配置 Docker apt 源..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

ARCH="$(dpkg --print-architecture)"
. /etc/os-release
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

# 3) 安装 Docker + compose 插件
log "安装 Docker Engine + compose..."
apt-get update
apt-get install -y --no-install-recommends \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

# 4) 创建 4G swap（2C4G 兜底，防 OOM）
log "创建 4G swap..."
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "swap 已创建并写入 fstab"
else
  log "swap 已存在，跳过"
fi

log "验证..."
docker --version
docker compose version
free -h

echo
echo "✅ 初始化完成。"
echo "下一步:"
echo "  1. 开放安全组/防火墙端口 3333 与 8000（供香港 Caddy 反代）"
echo "  2. cp deploy/compose/.env.production.example deploy/compose/.env 并填写"
echo "  3. 国内服务器 cd 到仓库根目录，执行:"
echo "     docker compose -f deploy/compose/docker-compose.yml up -d --build"
