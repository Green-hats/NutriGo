# Python Agent 文档

## 概述

AI 服务层，负责 LLM 对话（Agent Loop）、食物图片识别、营养计算、RAG 知识库检索。端口 **8000**。

技术栈：FastAPI + litellm + Chinese-CLIP + ChromaDB

## 启动

```bash
cd agent && LITELLM_LOCAL_MODEL_COST_MAP=true uv run uvicorn app.main:app --port 8000
# 或
cd NutriGo && ./start.sh
```

首次启动需下载两个模型（自动）：
- Chinese-CLIP ViT-B-16 (~400MB)
- BGE-small-zh-v1.5 (~100MB)

## 配置

复制 `.env.example` 为 `.env`，填入 LLM API Key：

```bash
LLM_MODEL=openai/qwen3.7-max             # litellm 格式，需支持 reasoning_content
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://opencode.ai/zen/go/v1
GO_BACKEND_URL=http://localhost:3333
INTERNAL_TOKEN=nutri-go-internal-token-dev
JWT_SECRET=nutri-go-secret-key-change-in-production   # 与 Go 后端一致
```

> **模型选择**：Agent 的"思考过程"面板依赖模型返回 `reasoning_content`（思维链）。
> 实测 opencode-go 上：`deepseek-v4-flash` **不返回**思维链；`deepseek-v4-pro`/`glm-5.2`
> 有思维链但正文易被截断；**`qwen3.7-max` 思维链与正文均正常**，故默认使用它。
> 模型名需用 `openai/` 前缀（litellm 不识别 `opencode-go/` 前缀）。

## 目录结构

```
agent/
├── app/                         # 对话层
│   ├── main.py                  # FastAPI 入口 + 6 条路由
│   ├── config.py                # 环境变量 + 系统提示词
│   ├── models.py                # Pydantic 模型
│   ├── db.py                    # agent.db (会话持久化，按 user_id 过滤)
│   ├── auth.py                  # JWT 验签（HS256，纯标准库，兼容 Go）
│   ├── tools.py                 # ToolRegistry + 4 个工具注册
│   ├── conversation.py          # 对话状态 + 持久化（含 thinking 字段）
│   ├── chat_io.py               # SSE 实时流式（asyncio.Queue）
│   └── llm_client.py            # Agent Loop（流式工具调用 + 思维链推送）
├── recognition/                 # 识别层
│   ├── db.py                    # nutrition.db (8407 条食物)
│   ├── multimodal.py            # Chinese-CLIP 识别
│   ├── go_client.py             # httpx → Go 后端
│   ├── nutrition.py             # 营养计算 + Agent 工具函数
│   └── rag.py                   # ChromaDB RAG 知识库
├── chroma_db/                   # 向量数据库（2277 条教材文档）
├── nutrition.db                 # 食物营养数据库（8407 条）
├── .env.example
├── pyproject.toml
└── test_agent.py                # 18 个测试用例
```

## 路由

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/chat?message=&session_id=` | JWT | SSE 流式对话（含 thinking + 工具调用事件） |
| GET | `/api/sessions` | JWT | 会话列表（仅当前用户） |
| GET | `/api/sessions/:id` | JWT | 会话详情（校验归属，越权 404） |
| DELETE | `/api/sessions/:id` | JWT | 删除会话（校验归属） |
| POST | `/api/identify-food` | — | CLIP 食物识别（家常菜分类） |
| POST | `/api/calculate-intake` | — | 按克数算实际摄入营养 |

> `/api/chat` 及会话管理路由均要求请求头 `Authorization: Bearer <JWT>`。
> `user_id` **不再**通过 URL 参数传入，而是从 JWT 中解出（`app/auth.py`）。
> 未带 token / token 无效 → `401`；越权访问他人会话 → `404`。

## Agent 工具（4 个）

| 工具 | 数据源 | 功能 |
|------|--------|------|
| `lookup_food_nutrition` | nutrition.db | 查食物每 100g 营养 |
| `get_user_profile` | Go 后端 | 查用户档案（过敏原、目标、基础病等） |
| `get_diet_history` | Go 后端 | 查某天饮食记录 |
| `search_nutrition_knowledge` | ChromaDB | 搜索《营养学》教材知识库 |

## Agent Loop 流程

```
JWT 校验（提取 user_id） → 系统提示词注入 user_id
→ 用户消息 → LLM 流式推理
  ├── reasoning_content → thinking 事件（思维链，前端折叠展示）
  ├── chunk token       → 实时 SSE 推送
  ├── tool_call → 执行工具（查 DB / 调 Go / 搜 ChromaDB）
  │             → 结果追加到对话
  │             → 继续 LLM
  └── done → 对话保存到 agent.db
```

### SSE 事件类型

| 事件 | 触发时机 | 前端处理 |
|------|---------|---------|
| `thinking` | 模型思维链逐段返回 | 折叠面板「🤔 思考过程」流式展示 |
| `chunk` | 正文逐 token | 打字机渲染 |
| `tool_call` | Agent 决定调用工具 | 展示工具卡片 |
| `tool_result` | 工具执行完成 | 展示结果 |
| `done` / `error` | 结束 / 出错 | 收尾 |

> 思维链仅在模型返回 `reasoning_content` 时出现。无思维链的模型（如 deepseek-v4-flash）
> 会自动跳过 thinking 事件，不影响正文流式输出。

### 用户身份识别

- `user_id` 从 `Authorization` 头中的 JWT 解出，**不信任 URL 参数**
- `conversation.py` 的 `_build_system_msg()` 会把 user_id 注入系统提示词，
  让 LLM 调用 `get_user_profile` 等工具时直接使用，不再向用户索要 ID
- `llm_client.py` 执行工具时还会用 `defaults={"user_id": conv.user_id}` 兜底补齐参数

## 数据库

| 文件 | 表/集合 | 说明 |
|------|--------|------|
| `agent.db` | sessions | 对话历史持久化（含 user_id 归属） |
| `nutrition.db` | foods | 8407 条食物，按 category 推断份量 |
| `chroma_db/` | nutrition_textbook | 2277 条教材文档，BGE 嵌入 |

## Chinese-CLIP

模型：OFA-Sys/chinese-clip-vit-base-patch16 (~400MB)

```python
from recognition.multimodal import identify
results = identify(image_bytes, labels=["宫保鸡丁", "红烧肉", ...], top_k=5)
# → [{"name":"宫保鸡丁","confidence":0.73}, ...]
```

当前使用"家常菜"分类（510 条），可通过 `list_names(category="四川菜")` 切换。

## ChromaDB RAG

嵌入模型：BAAI/bge-small-zh-v1.5（免费，中文优化）
文档来源：《营养学》教材 8 篇（基础营养、食物营养、人群营养等）

```python
from recognition.rag import search
docs = search("糖尿病饮食建议", top_k=3)
# → [教材段落1, 教材段落2, 教材段落3]
```

查询延迟 < 1 秒，无需 API Key。

## 测试

```bash
cd agent && uv run python test_agent.py
```

18 个用例，覆盖：JWT 鉴权（无 token/坏 token → 401）、会话 CRUD、SSE 对话、
营养计算。测试脚本内置 JWT 生成工具（`make_token` / `auth_headers`），无需真实登录。
完整 Agent 工具链测试需 Go 后端运行；用干净数据库跑最准（`DATABASE_PATH=/tmp/test.db`）。
