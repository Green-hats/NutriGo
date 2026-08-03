#!/bin/bash
# ============================================================================
# NutriGo 一键启动/停止脚本
# 用法:
#   ./start.sh          # 启动全部服务
#   ./start.sh stop     # 停止全部服务
#   ./start.sh status   # 查看服务状态
# ============================================================================

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
GO_BIN="/tmp/nutrigo-server"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# ---- NVM ----
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# ============================================================
stop_services() {
    echo "🛑 停止所有服务..."
    fuser -k 3333/tcp 2>/dev/null && echo "  Go (:3333) 已停止" || true
    fuser -k 8000/tcp 2>/dev/null && echo "  Python (:8000) 已停止" || true
    fuser -k 5173/tcp 2>/dev/null && echo "  前端 (:5173) 已停止" || true
    echo "✅ 全部停止"
}

check_status() {
    echo "╔═══════════════════════════════════╗"
    echo "║  NutriGo 服务状态                ║"
    echo "╠═══════════════════════════════════╣"
    if curl -s --max-time 2 http://localhost:3333/api/health > /dev/null 2>&1; then
        echo -e "║  Go 后端      :3333  ${GREEN}运行中${NC}        ║"
    else
        echo -e "║  Go 后端      :3333  ${RED}已停止${NC}        ║"
    fi
    if curl -s --max-time 2 http://localhost:8000/api/sessions > /dev/null 2>&1; then
        echo -e "║  Python Agent :8000  ${GREEN}运行中${NC}        ║"
    else
        echo -e "║  Python Agent :8000  ${RED}已停止${NC}        ║"
    fi
    if curl -s --max-time 2 http://localhost:5173 > /dev/null 2>&1; then
        echo -e "║  前端 Vite    :5173  ${GREEN}运行中${NC}        ║"
    else
        echo -e "║  前端 Vite    :5173  ${RED}已停止${NC}        ║"
    fi
    echo "╚═══════════════════════════════════╝"
}

start_services() {
    echo "🚀 启动 NutriGo..."

    # 先停旧进程
    stop_services
    sleep 1
    rm -f "$ROOT/backend/data.db" "$ROOT/agent/agent.db"

    # ---- Go ----
    echo "  [1/3] 编译 Go..."
    cd "$ROOT/backend"
    go build -o "$GO_BIN" ./cmd/server 2>&1
    nohup "$GO_BIN" > /tmp/nutrigo-go.log 2>&1 &
    sleep 1
    if curl -s --max-time 3 http://localhost:3333/api/health > /dev/null 2>&1; then
        echo -e "  [1/3] Go 后端      ${GREEN}✅${NC}  :3333"
    else
        echo -e "  [1/3] Go 后端      ${RED}❌ 启动失败${NC}"
        exit 1
    fi

    # ---- Python ----
    echo "  [2/3] 启动 Python Agent..."
    cd "$ROOT/agent"
    LITELLM_LOCAL_MODEL_COST_MAP=true nohup uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/nutrigo-py.log 2>&1 &
    sleep 5
    if curl -s --max-time 3 http://localhost:8000/api/sessions > /dev/null 2>&1; then
        echo -e "  [2/3] Python Agent ${GREEN}✅${NC}  :8000"
    else
        echo -e "  [2/3] Python Agent ${RED}❌ 启动失败${NC}"
        exit 1
    fi

    # ---- 前端 ----
    echo "  [3/3] 启动前端..."
    cd "$ROOT/frontend"
    nohup npx vite --host 0.0.0.0 > /tmp/nutrigo-fe.log 2>&1 &
    sleep 3
    if curl -s --max-time 3 http://localhost:5173 > /dev/null 2>&1; then
        echo -e "  [3/3] 前端 Vite   ${GREEN}✅${NC}  :5173"
    else
        echo -e "  [3/3] 前端 Vite   ${RED}❌ 启动失败${NC}"
        exit 1
    fi

    echo ""
    echo "╔═══════════════════════════════════╗"
    echo "║  全部服务启动完成！              ║"
    echo "╠═══════════════════════════════════╣"
    echo "║  前端:    http://localhost:5173   ║"
    echo "║  Go API:  http://localhost:3333   ║"
    echo "║  Py API:  http://localhost:8000   ║"
    echo "╠═══════════════════════════════════╣"
    echo "║  查看日志:                        ║"
    echo "║  tail -f /tmp/nutrigo-go.log      ║"
    echo "║  tail -f /tmp/nutrigo-py.log      ║"
    echo "║  tail -f /tmp/nutrigo-fe.log      ║"
    echo "║  ./start.sh stop    → 停止        ║"
    echo "║  ./start.sh status  → 状态        ║"
    echo "╚═══════════════════════════════════╝"
}

# ============================================================
case "${1:-start}" in
    stop)   stop_services ;;
    status) check_status ;;
    start)  start_services ;;
    *)      echo "用法: $0 {start|stop|status}" ;;
esac
