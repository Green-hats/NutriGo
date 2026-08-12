# NutriGo 统一命令入口
# 用法：make <target>，常见：
#   make dev          启动全部服务（等价 ./start.sh）
#   make stop         停止全部服务
#   make test         运行全部测试
#   make lint         运行 lint（前端 oxlint + 后端 ruff）
#   make build        编译 Go + 前端构建

SHELL := /bin/bash
ROOT := $(shell pwd)

.PHONY: dev stop status build test test-agent-unit test-agent test-backend test-identify lint lint-frontend lint-backend env

## ---- 启动/停止 ----
dev:
	./start.sh

stop:
	./start.sh stop

status:
	./start.sh status

## ---- 构建 ----
build:
	cd backend && go build -o /tmp/nutrigo-server ./cmd/server
	cd frontend && bash -c 'export NVM_DIR="$$HOME/.nvm"; . "$$NVM_DIR/nvm.sh"; node_modules/.bin/vite build'
	@echo "✅ 构建完成"

## ---- 测试 ----
test: test-go-unit test-frontend test-agent-unit test-backend test-agent test-identify

# Go 单元测试（无需启动服务）
test-go-unit:
	@echo "== Go 单元测试 =="
	cd backend && go test ./internal/...
	@echo "✅ Go 单元测试通过"

# 前端单元测试（vitest，无需启动服务）
test-frontend:
	@echo "== 前端单元测试 =="
	cd frontend && bash -c 'export NVM_DIR="$$HOME/.nvm"; . "$$NVM_DIR/nvm.sh"; node_modules/.bin/vitest run'
	@echo "✅ 前端单元测试通过"

test-backend:
	@echo "== Go 后端集成测试（需 Go 服务运行）=="
	cd backend && python3 tests/test_api.py

test-agent:
	@echo "== Agent 基础测试 =="
	cd agent && uv run python tests/integration/test_agent.py

# Agent 单元测试（pytest，不联网、不加载模型）
test-agent-unit:
	@echo "== Agent 单元测试（pytest）=="
	cd agent && uv run pytest
	@echo "✅ Agent 单元测试通过"

test-identify:
	@echo "== Agent 图片识别测试 =="
	cd agent && uv run python tests/integration/test_identify.py

test-prompts:
	@echo "== Agent 全面提示词测试（需 Agent 服务运行，耗时较长）=="
	cd agent && uv run python -u tests/integration/test_agent_prompts.py --quick

## ---- Lint ----
lint: lint-frontend lint-backend typecheck

lint-frontend:
	@echo "== 前端 oxlint =="
	cd frontend && bash -c 'export NVM_DIR="$$HOME/.nvm"; . "$$NVM_DIR/nvm.sh"; node_modules/.bin/oxlint src'
	@echo "✅ 前端 lint 通过"

lint-backend:
	@echo "== Python ruff =="
	cd agent && uv run ruff check app/ recognition/ tests/
	@echo "✅ Python lint 通过"

# mypy 类型检查
typecheck:
	@echo "== Python mypy 类型检查 =="
	cd agent && uv run mypy app/ recognition/
	@echo "✅ 类型检查通过"

## ---- 环境 ----
env:
	@echo "== 检查 .env 文件 =="
	@test -f agent/.env && echo "✅ agent/.env 存在" || echo "⚠️  agent/.env 缺失，请复制 agent/.env.example 为 agent/.env"
	@echo "== 后端环境变量 =="
	@echo "ℹ️  后端由 docker-compose/部署脚本注入环境变量（见 backend/.env.example、deploy/compose/.env.production.example），本地开发使用内置默认值即可"
