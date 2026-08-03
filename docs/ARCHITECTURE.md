# NutriGo — 架构设计文档

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                 React + TypeScript (前端)                        │
│           Vite / shadcn-ui / TailwindCSS / Zustand               │
└──┬──────────────┬──────────────────┬────────────────────────────┘
   │ REST (CRUD)  │ REST (识别触发)    │ SSE (对话流)
   ▼              ▼                  ▼
┌──────────────┐  ┌─────────────────────────────────────────────────┐
│  Go (Gin)    │  │              Python (FastAPI)                    │
│   :3333      │  │               :8000                             │
│              │  │                                                  │
│ • 用户注册/登录 │  │ • LLM 对话 + Agent Loop ── SSE 流式输出          │
│ • 健康档案 CRUD│  │ • 食物图片识别 (Chinese-CLIP) ── REST            │
│ • 饮食记录 CRUD│  │ • RAG 营养知识检索 (ChromaDB)                    │
│ • 图片上传存储  │  │ • 外部营养 API 调用                              │
│ • JWT 认证    │  │ • 调用 Go API 获取用户/图片数据                    │
│ • 图片获取 API │  │                                                  │
│   SQLite     │  │                                                  │
└──────┬───────┘  └─────────────────────────────────────────────────┘
       │                        │
       └────── REST ────────────┘
      (Python 需要用户画像/饮食记录/图片时，调 Go 的 API)
```

---

## 二、技术栈

| 层 | 技术 |
|----|------|
| **前端** | React 18+ / TypeScript / Vite / shadcn-ui / TailwindCSS / Zustand / React Router |
| **Go 后端**（数据服务） | Gin / GORM / golang-jwt / SQLite |
| **Python 后端**（AI 服务） | FastAPI / litellm / ChromaDB / Chinese-CLIP / Pillow / httpx |

---

## 三、通讯方式

| 链路 | 方式 | 原因 |
|------|------|------|
| 前端 ↔ Go | REST | CRUD 请求-响应，无长连接需求 |
| 前端 ↔ Python（对话） | **SSE** | 单向流式输出，`EventSource` 自动重连，比 WebSocket 简单 |
| 前端 ↔ Python（食物识别） | REST | 上传触发请求-响应，非流式 |
| Python ↔ Go | REST | Python 需要用户画像、饮食记录、图片文件时，主动调 Go |

---

## 四、核心数据流

### 4.1 对话流程

```
用户输入消息
     │
     ▼
前端 EventSource → GET Python /api/chat?session_id=xxx&message=xxx
     │                    │
     │              Agent Loop 执行：
     │              LLM 推理 → 工具调用(查营养/查用户画像) → 再推理 → ...
     │                    │
     │              SSE: data: {chunk}\n\n
     ▼                    ▼
前端逐字流式渲染回复
```

### 4.2 食物识别流程

```
用户拍照/选择图片
     │
     ▼
前端 → POST Go /api/images/upload
     │         │
     │    存储图片到文件系统，写入数据库记录
     │    返回 { image_id, url }
     │
     ▼
用户点击"识别"
     │
     ▼
前端 → POST Python /api/identify-food
     │         { image_id: "xxx" }
     │                │
     │           Python → GET Go /api/images/:id/data   (拿到图片二进制)
     │                │
     │           Chinese-CLIP 推理识别
     │                │
     │           返回 [{ name, confidence }, ...]
     ▼                ▼
前端展示候选列表
     │
用户确认食物 + 份量
     │
     ├──→ POST Go /api/diet/logs          (写入饮食记录)
     │
     └──→ GET Python /api/chat?message=今天午餐吃了宫保鸡丁，帮我分析一下营养
          (LLM 结合用户画像 → SSE 流式返回营养分析与建议)
```

### 4.3 Python 调 Go 获取用户画像

```
用户对话: "帮我推荐今天的晚餐"
     │
     ▼
Python Agent Loop:
  LLM 决定需要用户画像
     │
     ▼
Agent 工具调用: get_user_profile()
     │
     ▼
Python → GET Go /api/users/:id/profile  (带内部服务鉴权 token)
     │         │
     │    返回 { height, weight, goal, allergies, ... }
     ▼         ▼
工具返回数据 → LLM 结合信息 → 推荐食谱 → SSE 流式返回
```

---

## 五、各层职责边界

| 服务 | 做 | 不做 |
|------|-----|-----|
| **前端** | 页面渲染、拍照交互、对话 UI、数据可视化 | 不直接调 LLM API |
| **Go** | 用户认证、用户画像 CRUD、饮食记录 CRUD、图片文件上传与存储、图片获取 API | 不做 AI 推理、不执行模型 |
| **Python** | LLM 对话(SSE)、Agent 编排与工具调用、食物图片识别、RAG 检索、外部营养 API、调 Go API 获取数据 | 不存用户数据、不存文件、不管理饮食记录 |

---

## 六、API 设计概览

### 6.1 Go 服务 (:3333)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `POST` | `/api/auth/register` | 用户注册 | 无 |
| `POST` | `/api/auth/login` | 用户登录，返回 JWT | 无 |
| `GET` | `/api/users/:id/profile` | 获取用户健康档案 | JWT + 内部 |
| `PUT` | `/api/users/:id/profile` | 更新用户健康档案 | JWT |
| `POST` | `/api/images/upload` | 上传食物图片 | JWT |
| `GET` | `/api/images/:id` | 获取图片元信息 | 内部 |
| `GET` | `/api/images/:id/data` | 获取图片二进制数据 | 内部 |
| `POST` | `/api/diet/logs` | 创建饮食记录 | JWT |
| `GET` | `/api/diet/logs` | 查询饮食记录列表（按日期） | JWT |
| `DELETE` | `/api/diet/logs/:id` | 删除饮食记录 | JWT |

### 6.2 Python 服务 (:8000)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/chat` | 对话（SSE 流式） | session_id |
| `POST` | `/api/identify-food` | 食物图片识别 | session_id |
| `GET` | `/api/sessions/:id` | 获取会话历史 | session_id |
| `DELETE` | `/api/sessions/:id` | 删除会话 | session_id |

---

## 七、Python 端模块（基于现有 AgentN 代码演进）

| 模块 | 来源 | 说明 |
|------|------|------|
| `llm_client.py` | **重构** | Agent Loop 保留，新增 SSE 流式 `stream()` 方法 |
| `tools.py` | **保留** | `@tool` 装饰器机制不变 |
| `conversation.py` | **保留** | 会话状态 + 回滚，适配 SSE ChatIO |
| `chat_io.py` | **保留重构** | ChatIO 抽象接口保留，新增 `SSEChatIO` 实现 |
| `db.py` | **保留** | SQLite 操作保留，仅用于会话持久化 |
| `nutrition_tools.py` | **新增** | Agent 工具：查营养、查用户画像、查食谱等 |
| `rag.py` | **新增** | ChromaDB 向量检索，加载营养知识文档 |
| `food_api.py` | **新增** | 调用 USDA / OpenFoodFacts 等外部营养 API |
| `multimodal.py` | **新增** | Chinese-CLIP 食物识别模型加载与推理 |
| `go_client.py` | **新增** | 封装对 Go 后端的 HTTP 调用 |
| `config.py` | **新增** | 配置管理，读取 .env |
| `main.py` | **重写** | FastAPI 入口，路由注册 |

---

## 八、Go 端模块

| 路径 | 说明 |
|------|------|
| `cmd/server/main.go` | 入口，Gin 路由注册、启动 |
| `internal/model/` | GORM 数据模型（User、UserProfile、FoodDiary、FoodImage） |
| `internal/repository/` | 数据库操作层 |
| `internal/service/` | 业务逻辑层 |
| `internal/handler/` | HTTP handler 层 |
| `internal/middleware/` | JWT 认证中间件 + 内部服务鉴权中间件 |
| `migrations/` | GORM AutoMigrate 或 SQL 迁移脚本 |

---

## 九、数据库设计

### 9.1 Go — data.db (SQLite)

```sql
-- users
CREATE TABLE users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,          -- bcrypt hash
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- user_profiles
CREATE TABLE user_profiles (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL UNIQUE REFERENCES users(id),
    height_cm      REAL,
    weight_kg      REAL,
    age            INTEGER,
    gender         TEXT,                -- male / female / other
    goal           TEXT,                -- lose_weight / maintain / gain_muscle
    allergies      TEXT,                -- JSON array
    dietary_habits TEXT,                -- JSON array, e.g. ["vegetarian", "no_pork"]
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- food_diary
CREATE TABLE food_diary (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    date       DATE NOT NULL,
    meal_type  TEXT,                    -- breakfast / lunch / dinner / snack
    food_name  TEXT NOT NULL,
    portion    TEXT,                    -- e.g. "200g", "1 bowl"
    calories   REAL,
    protein_g  REAL,
    fat_g      REAL,
    carbs_g    REAL,
    notes      TEXT,
    image_id   INTEGER REFERENCES food_images(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- food_images
CREATE TABLE food_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    filename   TEXT NOT NULL,
    path       TEXT NOT NULL,
    mime_type  TEXT,
    size_bytes INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 9.2 Python — agent.db (SQLite)

复用现有 AgentN 的 sessions 表结构：

```sql
CREATE TABLE sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    system_msg  TEXT NOT NULL DEFAULT '',
    messages    TEXT NOT NULL DEFAULT '[]',
    user_id     INTEGER,                  -- 新增：关联 Go 的用户 ID
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
```

### 9.3 ChromaDB（Python 端管理）

存储中国膳食指南、食物成分表等知识文档的向量嵌入，用于 RAG 检索。

---

## 十、目录结构

```
NutriGo/
├── PROPOSAL.md                # 项目策划书
├── ARCHITECTURE.md            # 架构设计文档（本文件）
├── ROADMAP.md                 # 开发路线图
├── .env                       # 环境变量
├── .gitignore
├── docker-compose.yml
│
├── backend/                   # Go 后端
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── handler/
│   │   │   ├── auth.go
│   │   │   ├── user.go
│   │   │   ├── diet.go
│   │   │   └── image.go
│   │   ├── middleware/
│   │   │   ├── jwt.go
│   │   │   └── internal_auth.go
│   │   ├── model/
│   │   │   ├── user.go
│   │   │   ├── user_profile.go
│   │   │   ├── food_diary.go
│   │   │   └── food_image.go
│   │   ├── repository/
│   │   ├── service/
│   │   └── config/
│   ├── migrations/
│   ├── uploads/
│   ├── go.mod
│   └── go.sum
│
├── agent/                     # Python Agent 服务
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── llm_client.py
│   │   ├── conversation.py
│   │   ├── tools.py
│   │   ├── chat_io.py
│   │   ├── db.py
│   │   ├── nutrition_tools.py
│   │   ├── rag.py
│   │   ├── food_api.py
│   │   ├── multimodal.py
│   │   └── go_client.py
│   ├── data/
│   │   └── kb/                # RAG 知识文档（中国膳食指南等）
│   ├── pyproject.toml
│   └── uv.lock
│
├── frontend/                  # React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/            # shadcn-ui 组件
│   │   │   ├── chat/
│   │   │   ├── food/
│   │   │   └── layout/
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── DietDiary.tsx
│   │   │   └── Profile.tsx
│   │   ├── hooks/
│   │   ├── stores/            # Zustand
│   │   ├── api/               # Go + Python API 调用封装
│   │   ├── types/             # TypeScript 类型定义
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
└── agentn_ref/                # 原 AgentN 代码引用（可选，方便对照）
    └── (复制自原 AgentN 项目)
```

---

## 十一、安全设计

| 层面 | 措施 |
|------|------|
| 传输安全 | 本地部署，服务间内网通信；公网部署需加 HTTPS |
| 认证 | JWT（用户认证）+ 静态 internal_token（Go ↔ Python 服务间鉴权） |
| 密码存储 | bcrypt 哈希 |
| 文件上传 | 限制文件类型（仅图片）和大小（10MB），文件名 UUID 化防遍历 |
| API Key | 通过 .env 注入，不编码在代码中，.gitignore 排除 |
| 数据隔离 | 用户只能访问自己的数据，通过 JWT 中的 user_id 校验 |

---

## 十二、部署方案

### 开发环境

```bash
# 三个终端分别启动
# Go
cd backend && go run ./cmd/server

# Python
cd agent && uv run python -m app.main

# 前端
cd frontend && npm run dev
```

### Docker 部署（后续）

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    ports: ["3333:3333"]
  agent:
    build: ./agent
    ports: ["8000:8000"]
  frontend:
    build: ./frontend
    ports: ["5173:5173"]
```
