# 🥗 NutriGo — AI 智能营养师

<div align="center">

[**English**](README.md) · [简体中文](README.zh-CN.md)

</div>

> 拍照识别食物，AI 分析营养，个性化膳食建议。一个功能完整的全栈 AI 营养助手。

[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go)](backend/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python)](agent/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](frontend/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript)](frontend/)
[![License](https://img.shields.io/github/license/Green-hats/NutriGo?logo=gnu)](LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/Green-hats/NutriGo/ci.yml?branch=main&logo=github&label=CI)](https://github.com/Green-hats/NutriGo/actions)
[![Release](https://img.shields.io/github/v/release/Green-hats/NutriGo?logo=github&label=Release)](https://github.com/Green-hats/NutriGo/releases)
[![Last Commit](https://img.shields.io/github/last-commit/Green-hats/NutriGo?logo=git&label=最近提交)](https://github.com/Green-hats/NutriGo)

---

## ✨ 功能特性

- **📷 拍照识别** — Chinese-CLIP 零样本识别食物，Top-5 候选，510+ 道家常菜
- **🤖 AI 对话** — Agent Loop + 5 个工具，SSE 流式实况输出，Markdown + 思维链展示
- **📚 RAG 知识库** — ChromaDB 2277 条《营养学》教材文档，回答专业营养问题
- **📊 营养分析** — 8407 条真实营养数据，按克数精确换算，多日趋势洞察
- **🗓️ 饮食日记** — 按日期记录三餐，recharts 柱状图展示营养趋势
- **👤 个性化档案** — 身高体重/目标/过敏原/基础病，AI 定制饮食建议
- **🛡️ 企业级安全** — JWT + 刷新令牌轮换与登出黑名单、认证接口 IP 限流、内部服务鉴权、生产环境密钥强制校验

---

## 🚀 快速开始

### 环境要求

| 工具 | 版本 |
|------|------|
| Go | 1.26+ |
| Python | 3.13+ |
| Node.js | 22+ |
| uv | 0.11+ |

### 安装

```bash
git clone https://github.com/Green-hats/NutriGo.git
cd NutriGo

# 配置 LLM API Key（支持 OpenAI/Gemini/DeepSeek/Ollama 等，通过 litellm）
cp agent/.env.example agent/.env
# 编辑 agent/.env 填入 LLM_API_KEY

# 一键启动全部服务
./start.sh
```

浏览器打开 **http://localhost:5173** 🎉

### 服务架构

| 服务 | 端口 | 技术栈 | 职责 |
|------|------|--------|------|
| `frontend` | :5173 | React 19 + TS + TailwindCSS | 用户界面 |
| `backend` | :3333 | Go + Gin + GORM + SQLite | 用户/数据/文件 |
| `agent` | :8000 | FastAPI + litellm + ChromaDB | AI 对话/识别/RAG |

---

## 🏗️ 架构

```
┌─────────────┐  REST / JWT   ┌──────────────┐
│  Frontend   │ ────────────► │   Backend    │
│  React 19   │ ◄──────────── │  Go + Gin    │
└─────┬───────┘               │    :3333     │
      │                       │  SQLite · JWT│
      │                       └───────▲───────┘
      │ SSE 对话 / REST 识别              │ REST (Internal Token)
      ▼                               │
┌─────┬───────────────────────────────┬─────────────────────┐
│                   Agent · FastAPI :8000                   │
│                  Agent Loop: 5 工具 + LLM                  │
│                  + RAG (ChromaDB) + CLIP                  │
└───────────────────────────────────────────────────────────┘
```

- **Agent Loop** — LLM 自主决定调用工具，支持思维链（reasoning_content）流式推送
- **5 个工具** — 查营养 / 查档案 / 查饮食记录 / 查营养趋势 / 搜知识库
- **RAG** — BGE-small-zh 嵌入 + ChromaDB 向量检索
- **多模态** — Chinese-CLIP 零样本食物识别

详细设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 📚 文档

| 文档 | 内容 |
|------|------|
| [架构设计](docs/ARCHITECTURE.md) | 系统架构、数据流、安全设计 |
| [API 文档](backend/API.md) | Go 后端全部接口 |
| [Agent 文档](docs/agent.md) | Python Agent 设计与工具说明 |
| [前端文档](docs/frontend.md) | React 前端结构 |
| [测试说明](docs/agent-test-prompts.md) | Agent 测试提示词集 |

---

## 🧪 测试

```bash
# 单元测试（无需启动服务，适合 CI）
make test-go-unit        # Go：75 用例
make test-frontend       # 前端 vitest：34 用例（store + 组件）
make test-agent-unit     # Agent pytest：63 用例（不联网、不加载模型）

# 集成测试（需服务运行）
make test-backend        # Go 后端：67 用例
make test-agent          # Agent 基础：20 用例
make test-identify       # 图片识别：13 用例
make test-prompts        # 全面提示词：--quick 核心 9 例

# 全部测试
make test
```

**静态检查**：`make lint`（ruff + mypy + oxlint）· `make typecheck`（mypy 类型检查）

---

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · TypeScript (strict) · TailwindCSS · Zustand · Vite · vitest |
| Agent | Python 3.13 · FastAPI · litellm · Chinese-CLIP · ChromaDB · SSE |
| 后端 | Go 1.26 · Gin · GORM · SQLite · JWT · bcrypt |
| 质量 | Go test · pytest · ruff · mypy · oxlint · vitest · GitHub Actions CI |

---

## 🤝 贡献

欢迎贡献！请参考：

- [贡献指南](CONTRIBUTING.zh-CN.md)
- 提交前运行 `make lint && make test`
- 遵循 Conventional Commits 规范

## 📄 许可证

本项目基于 [GPL v3](LICENSE) 许可证开源。

---

*NutriGo — 让每个人都拥有自己的 AI 营养师。*
