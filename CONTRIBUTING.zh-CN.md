# NutriGo 贡献指南

[English](CONTRIBUTING.md) · [架构设计](docs/ARCHITECTURE.md) · [手机端开发](docs/MOBILE.md)

NutriGo 包含 Tauri 2 手机 App 和 Go / Python 云端服务。建议使用 Go 1.26.5+、Python 3.13（CI 版本）、Node.js 24（支持 22.12+）及 uv。原生构建还需 Rust 和 Android / Apple 工具链，步骤见手机端文档。

## 开发环境

```bash
git clone https://github.com/Green-hats/NutriGo.git
cd NutriGo
cp agent/.env.example agent/.env
# 配置聊天供应商；DeepSeek 照片分析可单独填写 FOOD_VISION_API_KEY。
(cd agent && uv sync --group dev)
(cd frontend && npm ci)
./start.sh
```

`start.sh` 启动本地服务及浏览器预览。原生开发在 `frontend` 中运行 `npm run android:dev` 或 `npm run ios:dev`，先停止已有 Vite 进程。生产入口为 [deploy/cloud](deploy/cloud/README.md)。凭据、keystore、真实用户数据、运行数据库和备份不得提交 Git；`VITE_*` 只能包含公开配置。

## 无需启动业务服务的检查

从仓库根目录执行与改动相关的检查。这些测试不要求真实 AI 服务；安装依赖可能需要联网。

```bash
(cd backend && go test ./internal/... && go vet ./...)
(cd frontend && npm run lint && npm test && npm run build)
(cd agent && uv run ruff check app/ recognition/ tests/ ../.github/scripts/)
(cd agent && uv run mypy app/ recognition/ && uv run pytest)
(cd agent && uv run ruff check --config ../deploy/cloud/backup/ruff.toml ../deploy/cloud/backup/)
python3 -m unittest discover -s deploy/cloud/backup -p 'test_*.py'
python3 -m unittest discover -s .github/scripts -p 'test_*.py'
git diff --check
```

Go 使用 gofmt，前端构建执行严格 TypeScript 检查，Python 使用 ruff / mypy。行为变更应覆盖对应的正常与故障路径；纯文档修改主要验证链接、示例和图表。修改接口、数据生命周期或部署契约时，同步更新对应文档。

`make test` 还会执行需要服务的集成脚本，**不是**纯单元测试入口，也不包含所有 CI 检查。部分前端 Make 目标依赖 NVM，以上 npm 命令没有该假设。`make lint` 包含 Agent ruff / mypy 和前端 oxlint；Go vet、备份及发布脚本检查需单独执行。

## 集成、原生与发布验证

- Go HTTP 集成：`backend/tests/test_api.py` 需要独立运行的 Go 服务和干净测试库；CI 自行构建和启动服务，并为测试负载调整认证限流。
- Agent 联调：`agent/tests/integration/` 可能依赖 Go、模型文件和真实 LLM；部分脚本使用固定开发身份和密钥，先检查配置，不得针对生产用户数据执行。人工标准见[验收清单](docs/agent-test-prompts.md)。
- 网关：`python3 deploy/cloud/tests/verify_gateway.py` 需要本地 Caddy；CI 还校验 Compose 配置。
- 原生 App：`npm run build:app` 要求 HTTPS API 源地址；CI 示例地址只验证编译。Rust、iOS 目标检查和 Android APK 构建由 CI 执行，权限、键盘和拍照仍需真机验收。

[CI](.github/workflows/ci.yml) 包含 Lint、Test、Build、Tauri native check、Android compact APK、Cloud gateway 六个任务。[Android Release](.github/workflows/android-release.yml) 通过 main 手动触发或匹配版本的 `android-v<版本>` 标签触发，复用 CI 后签名并发布预发布版本。推送 main 会触发 CI，但不会自动发布 Release 或部署云端。签名与版本约束见 [MOBILE.md](docs/MOBILE.md)。

## 提交流程

1. Fork 仓库，为单一目标建立分支。
2. 说明用户遇到的问题和修改后的行为，更新相关测试与文档。
3. 执行适用检查，记录结果和尚未验证的部分。
4. 提交 PR，等待 CI 和维护者审阅。

使用 Conventional Commits，例如 `fix: preserve photo deletion tasks after filesystem errors`、`docs: align data lifecycle and deployment guides`。接入配置已实现与生产已启用应明确区分。当前缺口见[路线图](docs/ROADMAP.md)，保留和恢复规则见[数据管理](docs/DATA_MANAGEMENT.md)。
