# NutriGo — AI 智能营养师

> 拍照记录饮食，AI 分析营养，个性化膳食建议。

[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go)](backend/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python)](agent/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](frontend/)

---

## 快速开始

```bash
git clone <repo-url> && cd NutriGo
cp agent/.env.example agent/.env   # 填入 LLM API Key
./start.sh                         # 一键启动全部服务
```

浏览器打开 **http://localhost:5173**

| 服务 | 端口 | 技术栈 |
|------|------|--------|
| 前端 | :5173 | React 19 + TypeScript + TailwindCSS + Zustand |
| Go 后端 | :3333 | Gin + GORM + SQLite + JWT |
| Python Agent | :8000 | FastAPI + litellm + Chinese-CLIP + ChromaDB |

---

## 功能

- **用户系统** — 注册、登录、JWT 认证、健康档案
- **拍照识别** — Chinese-CLIP 零样本识别，510 道家常菜（可切换类别）
- **营养计算** — 8407 条真实营养数据（nutrition.db），按克数精确换算
- **AI 对话** — Agent Loop + 4 个工具，SSE 流式实况输出，Markdown 渲染
- **RAG 知识库** — ChromaDB 2277 条《营养学》教材文档，回答专业问题
- **饮食日记** — 按日期记录，recharts 柱状图展示营养趋势
- **会话历史** — 对话持久化，可恢复历史会话
- **数据聚合** — 7 天后自动汇总为每日摘要，释放存储

---

## 服务管理

```bash
./start.sh           # 启动全部
./start.sh stop      # 停止全部
./start.sh status    # 查看状态
```

日志文件：
| 日志 | 命令 |
|------|------|
| Go 后端 | `tail -f /tmp/nutrigo-go.log` |
| Python Agent | `tail -f /tmp/nutrigo-py.log` |
| 前端 | `tail -f /tmp/nutrigo-fe.log` |

---

## 项目结构

```
NutriGo/
├── start.sh                 # 一键启动脚本
├── README.md                # 本文件
├── .gitignore
├── docs/                    # 项目文档
│   ├── PROPOSAL.md          # 项目策划书
│   ├── ARCHITECTURE.md      # 架构设计文档
│   ├── ROADMAP.md           # 开发路线图
│   ├── backend.md           # Go 后端文档
│   ├── agent.md             # Python Agent 文档
│   └── frontend.md          # 前端文档
├── backend/                 # Go 后端 (:3333)
│   ├── cmd/server/          # 入口
│   ├── internal/            # handler / model / middleware / service
│   └── API.md               # API 文档
├── agent/                   # Python Agent (:8000)
│   ├── app/                 # 对话层（8 个文件）
│   ├── recognition/         # 识别层（5 个文件）
│   ├── chroma_db/           # ChromaDB 向量数据库（2277 条）
│   ├── nutrition.db         # 食物营养数据库（8407 条）
│   └── .env.example
├── test/                    # 测试文件
│   ├── backend/             # test_api.py（Go 后端）
│   ├── agent/               # test_agent.py / test_agent_prompts.py（Agent）
│   └── frontend/            # （预留）
└── frontend/                # React 前端 (:5173)
    └── src/
        ├── api/             # Go / Python / SSE 封装
        ├── stores/          # Zustand 状态
        ├── components/      # 共享组件
        └── pages/           # 5 个页面
```

---

## 环境要求

| 工具 | 版本 |
|------|------|
| Go | 1.22+ |
| Python | 3.11+ |
| Node.js | 20+ |
| uv | 0.11+ |

首次运行自动下载：
| 模型 | 大小 | 用途 |
|------|------|------|
| Chinese-CLIP ViT-B-16 | ~400MB | 食物图片识别 |
| BGE-small-zh-v1.5 | ~100MB | RAG 文本嵌入 |
| ChromaDB 向量库 | ~5MB | 营养知识检索 |

---

## 技术亮点

| 特性 | 实现 |
|------|------|
| 多模态识别 | Chinese-CLIP ViT-B-16 零样本，CPU 推理 |
| Agent Loop | litellm 多模型支持，4 工具流式调用 |
| RAG 知识库 | ChromaDB + BGE 嵌入，2277 条教材文档 |
| 真流式输出 | asyncio.Queue + SSE，逐 token 推送 |
| 服务分离 | Go 管数据，Python 管 AI，各司其职 |
| 数据安全 | bcrypt 密码，JWT 鉴权，数据隔离 |
| 离线可用 | SQLite 本地存储，BGE 免费嵌入模型 |
