# NutriGo — AI 智能营养师

> 拍照记录饮食，AI 分析营养，个性化膳食建议。

[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go)](backend/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python)](agent/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](frontend/)

---

## 快速开始

```bash
git clone <repo-url> && cd NutriGo
./start.sh          # 一键启动全部服务
```

浏览器打开 **http://localhost:5173**

| 服务 | 端口 | 技术栈 |
|------|------|--------|
| 前端 | :5173 | React 19 + TypeScript + TailwindCSS + Zustand |
| Go 后端 | :3333 | Gin + GORM + SQLite + JWT |
| Python Agent | :8000 | FastAPI + litellm + Chinese-CLIP |

---

## 功能

- **用户系统** — 注册、登录、JWT 认证、健康档案
- **拍照识别** — Chinese-CLIP 零样本识别 8407 种食物
- **营养计算** — 按克数精确换算热量/蛋白质/脂肪/碳水
- **AI 对话** — Agent Loop + 3 个工具，SSE 流式实况输出
- **饮食日记** — 按日期记录，条状图展示营养趋势
- **数据聚合** — 7 天自动汇总，释放存储空间
- **图片清理** — 过期图片定时清理

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
├── PROPOSAL.md              # 项目策划书
├── ARCHITECTURE.md          # 架构设计文档
├── ROADMAP.md               # 开发路线图
├── docs/                    # 详细文档
│   ├── PROPOSAL.md          # 项目策划书
│   ├── ARCHITECTURE.md      # 架构设计文档
│   ├── ROADMAP.md           # 开发路线图
│   ├── backend.md           # Go 后端文档
│   ├── agent.md             # Python Agent 文档
│   └── frontend.md          # 前端文档
├── backend/                 # Go 后端
│   ├── cmd/server/main.go
│   ├── internal/
│   ├── API.md               # API 文档
│   └── test_api.py          # 自动化测试
├── agent/                   # Python Agent
│   ├── app/                 # 对话层
│   ├── recognition/         # 识别层
│   ├── .env.example
│   └── test_agent.py
└── frontend/                # React 前端
    └── src/
```

---

## 环境要求

| 工具 | 版本 |
|------|------|
| Go | 1.22+ |
| Python | 3.11+ |
| Node.js | 20+ |
| uv | 0.11+ |

可选：
- LLM API Key（推荐 [DeepSeek](https://platform.deepseek.com) 免费 500 次/天）
- Chinese-CLIP 模型（首次运行自动下载 ~400MB）

---

## 技术亮点

| 特性 | 实现 |
|------|------|
| 多模态识别 | Chinese-CLIP ViT-B-16 零样本，CPU 可跑 |
| Agent Loop | litellm 多模型支持，流式工具调用 |
| 服务分离 | Go 管数据，Python 管 AI，各司其职 |
| 数据安全 | bcrypt 密码，JWT 鉴权，数据隔离 |
| 离线可用 | SQLite 本地存储，不依赖云服务 |
