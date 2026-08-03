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
LLM_MODEL=openai/deepseek-v4-flash        # litellm 格式
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.opencode.ai/zen/go/v1
GO_BACKEND_URL=http://localhost:3333
INTERNAL_TOKEN=nutri-go-internal-token-dev
```

## 目录结构

```
agent/
├── app/                         # 对话层
│   ├── main.py                  # FastAPI 入口 + 6 条路由
│   ├── config.py                # 环境变量 + 系统提示词
│   ├── models.py                # Pydantic 模型
│   ├── db.py                    # agent.db (会话持久化)
│   ├── tools.py                 # ToolRegistry + 4 个工具注册
│   ├── conversation.py          # 对话状态 + 持久化
│   ├── chat_io.py               # SSE 实时流式（asyncio.Queue）
│   └── llm_client.py            # Agent Loop（流式工具调用版）
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
└── test_agent.py                # 16 个测试用例
```

## 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/chat?message=&user_id=` | SSE 流式对话 |
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/:id` | 会话详情 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/identify-food` | CLIP 食物识别（510 道家常菜） |
| POST | `/api/calculate-intake` | 按克数算实际摄入营养 |

## Agent 工具（4 个）

| 工具 | 数据源 | 功能 |
|------|--------|------|
| `lookup_food_nutrition` | nutrition.db | 查食物每 100g 营养 |
| `get_user_profile` | Go 后端 | 查用户档案（过敏原、目标等） |
| `get_diet_history` | Go 后端 | 查某天饮食记录 |
| `search_nutrition_knowledge` | ChromaDB | 搜索《营养学》教材知识库 |

## Agent Loop 流程

```
用户消息 → LLM 流式推理
  ├── chunk token → 实时 SSE 推送
  ├── tool_call → 执行工具（查 DB / 调 Go / 搜 ChromaDB）
  │             → 结果追加到对话
  │             → 继续 LLM
  └── done → 对话保存到 agent.db
```

## 数据库

| 文件 | 表/集合 | 说明 |
|------|--------|------|
| `agent.db` | sessions | 对话历史持久化 |
| `nutrition.db` | food_nutrition / food_portion | 8407 条食物，72 个分类 |
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

需要 Go 后端运行才能测试完整 Agent 工具链。
