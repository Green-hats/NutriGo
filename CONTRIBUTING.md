# 贡献指南

感谢你对 NutriGo 感兴趣！以下指南帮助你顺利参与贡献。

## 目录

- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [提交流程](#提交流程)
- [Commit 规范](#commit-规范)

## 开发环境

```bash
# 1. 克隆并安装依赖
git clone <repo-url> && cd NutriGo
cp agent/.env.example agent/.env   # 填入 LLM_API_KEY

# 2. 启动开发环境
./start.sh                          # 或 make dev

# 3. 验证环境就绪
make env                            # 检查 .env
```

需要：Go 1.26+、Python 3.13+、Node.js 22+、uv 0.11+

## 代码规范

| 语言 | 工具 | 命令 |
|------|------|------|
| Python | ruff + mypy + pytest | `cd agent && uv run ruff check app/ recognition/ tests/ && uv run mypy app/ recognition/ && uv run pytest` |
| Go | gofmt + go vet | `cd backend && gofmt -l . && go vet ./...` |
| TypeScript | oxlint + tsc strict | `cd frontend && npx oxlint src && npx tsc -b` |

**提交前必须通过**：`make lint && make test`（Go / Agent pytest / vitest 单元测试，无需启动服务）

## 提交流程

1. **Fork** 本仓库，创建特性分支：`git checkout -b feat/your-feature`
2. 编写代码并**补充/更新测试**
3. 本地验证：`make lint && make test`
4. 提交并推送，创建 Pull Request
5. 等待 CI 通过 + 维护者 review

## Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org)：

```
feat: 新功能
fix: 修复 bug
docs: 文档变更
refactor: 重构（非修复非功能）
test: 增加测试
chore: 构建/工具/依赖
style: 格式调整
```

示例：`feat: 添加摄入达标率分析工具`
