# NutriGo — 架构设计文档

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                 React + TypeScript (前端)                        │
│        Vite / TailwindCSS / Zustand / React Router               │
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
│ • 图片上传存储  │  │ • 食物营养库查询 (nutrition.db)                   │
│ • JWT+刷新令牌 │  │ • 调用 Go API 获取用户/图片数据                    │
│ • IP 限流      │  │                                                  │
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
| **前端** | React 19 / TypeScript (strict) / Vite / TailwindCSS / Zustand / React Router |
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
| **Python** | LLM 对话(SSE)、Agent 编排与工具调用、食物图片识别、RAG 检索、食物营养库查询、调 Go API 获取数据 | 不存用户数据、不存文件、不管理饮食记录 |

---

## 六、API 设计概览

### 6.1 Go 服务 (:3333)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/health` | 健康检查 | 无 |
| `GET` | `/api/ready` | 就绪探针（校验 DB 连接） | 无 |
| `GET` | `/api/metrics` | Prometheus 指标 | 无 |
| `POST` | `/api/auth/register` | 用户注册 | 无（IP 限流） |
| `POST` | `/api/auth/login` | 登录，返回 JWT + 刷新令牌 | 无（IP 限流） |
| `POST` | `/api/auth/refresh` | 刷新令牌轮换 | 无（IP 限流） |
| `POST` | `/api/auth/logout` | 登出，吊销令牌 | JWT |
| `GET` | `/api/users/:id/profile` | 获取用户健康档案 | JWT |
| `PUT` | `/api/users/:id/profile` | 更新用户健康档案 | JWT |
| `POST` | `/api/images/upload` | 上传食物图片 | JWT |
| `DELETE` | `/api/images/:id` | 删除图片 | JWT |
| `POST` | `/api/diet/logs` | 创建饮食记录 | JWT |
| `GET` | `/api/diet/logs?date=` | 查询饮食记录列表 | JWT |
| `DELETE` | `/api/diet/logs/:id` | 删除饮食记录 | JWT |
| `GET` | `/api/diet/summaries?start=&end=` | 每日营养汇总 | JWT |
| `GET` | `/api/internal/users/:id/profile` | 查档案（Agent 用） | 内部 |
| `GET` | `/api/internal/diet/logs` | 查饮食记录（Agent 用） | 内部 |
| `GET` | `/api/internal/diet/summaries` | 查每日汇总（Agent 用） | 内部 |
| `GET` | `/api/images/:id` | 图片元信息（Agent 用） | 内部 |
| `GET` | `/api/images/:id/data` | 图片二进制（Agent 用） | 内部 |

> 完整契约见 `backend/API.md`。

### 6.2 Python 服务 (:8000)

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/health` | 健康检查 | 无 |
| `GET` | `/api/chat?message=&session_id=` | 对话（SSE 流式） | JWT |
| `GET` | `/api/sessions` | 会话列表 | JWT |
| `GET` | `/api/sessions/:id` | 获取会话历史 | JWT |
| `POST` | `/api/sessions/:id/regenerate` | 重新生成最后回复 | JWT |
| `DELETE` | `/api/sessions/:id` | 删除会话 | JWT |
| `PATCH` | `/api/sessions/:id` | 重命名会话 | JWT |
| `POST` | `/api/identify-food` | 食物图片识别 | JWT |
| `POST` | `/api/calculate-intake` | 按克数计算摄入营养 | JWT |

---

## 七、Python 端模块（基于现有 AgentN 代码演进）

| 模块 | 来源 | 说明 |
|------|------|------|
| `llm_client.py` | **重构** | Agent Loop 保留，新增 SSE 流式 `stream()` 方法 |
| `tools.py` | **保留** | `@tool` 装饰器机制不变 |
| `conversation.py` | **保留** | 会话状态 + 回滚，适配 SSE ChatIO |
| `chat_io.py` | **保留重构** | ChatIO 抽象接口保留，新增 `SSEChatIO` 实现 |
| `db.py` | **保留** | SQLite 操作保留，仅用于会话持久化 |
| `nutrition.py` | **新增** | Agent 工具实现：查营养、查用户画像、查饮食记录/汇总 |
| `rag.py` | **新增** | ChromaDB 向量检索，加载营养知识文档 |
| `multimodal.py` | **新增** | Chinese-CLIP 食物识别模型加载与推理 |
| `go_client.py` | **新增** | 封装对 Go 后端的 HTTP 调用 |
| `config.py` | **新增** | 配置管理，读取 .env |
| `main.py` | **重写** | FastAPI 入口，路由注册 |

---

## 八、Go 端模块

| 路径 | 说明 |
|------|------|
| `cmd/server/main.go` | 入口，Gin 路由注册、优雅关闭、启动后台任务 |
| `internal/config/` | 密钥加载（jwt.go）、DB 连接、限流/保留期常量 |
| `internal/model/` | GORM 数据模型（User、UserProfile、FoodDiary、FoodImage、DailySummary、RefreshToken、BlacklistedToken） |
| `internal/handler/` | HTTP handler 层（auth/profile/diet/image/summary + validate） |
| `internal/middleware/` | JWT 认证 + 内部服务鉴权 + IP 限流 + 可观测性 |
| `internal/service/` | 后台任务（图片清理 / 记录聚合 / 令牌清理） |

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
    chronic_diseases TEXT,              -- JSON array, e.g. ["hypertension", "diabetes"]
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

-- refresh_tokens（刷新令牌，只存 SHA-256 哈希）
CREATE TABLE refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    family_id  TEXT NOT NULL DEFAULT '',   -- 令牌家族，用于重放检测
    token_hash TEXT NOT NULL UNIQUE,       -- SHA-256(token)，不存明文
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,                   -- 轮换/登出后置位
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- blacklisted_tokens（登出后被吊销的访问令牌，按 jti）
CREATE TABLE blacklisted_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    jti        TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,          -- 到期后由清理任务删除
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
│   │   │   ├── auth.go        # 注册/登录/刷新令牌/登出
│   │   │   ├── profile.go
│   │   │   ├── diet.go
│   │   │   ├── image.go
│   │   │   └── summary.go
│   │   ├── middleware/
│   │   │   ├── jwt.go         # JWT 校验 + 黑名单
│   │   │   ├── internal_auth.go
│   │   │   ├── rate_limit.go  # IP 令牌桶限流
│   │   │   └── observability.go # 请求日志 + 指标
│   │   ├── model/
│   │   │   ├── user.go
│   │   │   ├── food_diary.go
│   │   │   ├── food_image.go
│   │   │   ├── daily_summary.go
│   │   │   └── token.go       # 刷新令牌 / 黑名单表
│   │   ├── service/           # 后台任务
│   │   │   ├── aggregator.go
│   │   │   ├── cleanup.go
│   │   │   └── token_cleanup.go
│   │   └── config/            # 密钥/DB/限流/保留期配置
│   ├── uploads/               # 运行期生成（.gitignore）
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
│   │   ├── db.py              # 会话持久化
│   │   └── auth.py            # JWT 校验（标准库）
│   ├── recognition/
│   │   ├── nutrition.py       # Agent 工具函数
│   │   ├── rag.py             # ChromaDB 检索
│   │   ├── multimodal.py      # Chinese-CLIP 识别
│   │   ├── db.py              # nutrition.db 食物库
│   │   └── go_client.py       # Go 后端 HTTP 客户端
│   ├── tests/                 # pytest 单元测试
│   ├── chroma_db/             # RAG 向量库（运行期生成）
│   ├── nutrition.db           # 预置食物营养库（8407 条）
│   ├── pyproject.toml
│   └── uv.lock
│
├── frontend/                  # React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/            # 自定义基础组件
│   │   │   ├── chat/
│   │   │   ├── diary/
│   │   │   └── layout/
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── Diary.tsx
│   │   │   └── Profile.tsx
│   │   ├── stores/            # Zustand（auth / chat）
│   │   ├── api/               # Go + Agent API 调用封装
│   │   ├── types/             # TypeScript 类型定义
│   │   ├── test/              # vitest 配置
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
└── agentn_ref/                # 原 AgentN 代码引用（可选，方便对照）
    └── (复制自原 AgentN 项目)
```

---

## 十一、安全设计

| 层面 | 措施 |
|------|------|
| 传输安全 | 本地部署，服务间内网通信；公网部署需加 HTTPS |
| 认证 | JWT（用户认证，短时 2h + 刷新令牌轮换 + 登出黑名单 + 重放检测）+ 静态 internal_token（Go ↔ Python 服务间鉴权） |
| 防爆破 | 登录/注册/刷新接口 IP 级令牌桶限流（5 次/分） |
| 密码存储 | bcrypt 哈希 |
| 文件上传 | 限制文件类型（仅图片）和大小（10MB），文件名 UUID 化防遍历 |
| API Key | 通过 .env 注入，不编码在代码中，.gitignore 排除 |
| 数据隔离 | 用户只能访问自己的数据，通过 JWT 中的 user_id 校验 |
| 令牌安全 | 刷新令牌只存 SHA-256 哈希；轮换后旧令牌立即失效 |

---

## 十二、选型与架构权衡

### 为什么用 SQLite 而不是 PostgreSQL

当前为**单实例、中小规模**部署（2C4G），数据量级为个位数用户 × 每日数十条记录：

- **零运维**：单文件、无独立进程，备份即复制文件，契合 Docker 单机部署
- **写入瓶颈不在当前量级**：SQLite 单写者限制在 QPS 远低于本项目流量时无感知
- **与聚合任务匹配**：后台聚合按日批量写入，天然符合 SQLite 的写模型

**何时需要迁移到 PostgreSQL**：多实例水平扩展、QPS 超过 SQLite 单写者上限、或需要外部写入方。
此时仅需替换 GORM driver（`config/db.go` 一行）并引入版本化迁移工具（如 golang-migrate）。

### 已知的并发限制（诚实声明）

以下机制均为**进程内**实现，仅适用于单实例部署：

- IP 限流表（`middleware/rate_limit.go`）与 Agent 的用户并发上限（`MAX_ACTIVE_PER_USER`）按进程计数
- 会话写锁（`app/rate_limit.py`）为单进程 asyncio.Lock

横向扩容到多实例时，需要把限流/并发控制外置到 Redis 等共享存储，
或通过负载均衡器的连接数控制兜底。

---

## 十三、部署方案

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
