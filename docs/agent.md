# Python Agent 文档

## 概述

AI 服务层，负责 LLM 对话（Agent Loop）、食物图片识别、营养计算。端口 **8000**。

技术栈：FastAPI + litellm + Chinese-CLIP + ChromaDB

## 启动

```bash
cd agent && LITELLM_LOCAL_MODEL_COST_MAP=true uv run uvicorn app.main:app --port 8000
# 或
cd NutriGo && ./start.sh
```

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
│   ├── main.py                  # FastAPI 入口 + 路由
│   ├── config.py                # 环境变量配置
│   ├── models.py                # Pydantic 模型
│   ├── db.py                    # agent.db (会话持久化)
│   ├── tools.py                 # ToolRegistry + 工具注册
│   ├── conversation.py          # 对话状态管理
│   ├── chat_io.py               # SSE 流式输出（asyncio.Queue）
│   └── llm_client.py            # Agent Loop（流式版本）
├── recognition/                 # 识别层
│   ├── db.py                    # nutrition.db (8407 条食物)
│   ├── multimodal.py            # Chinese-CLIP 识别
│   ├── go_client.py             # httpx → Go 后端
│   └── nutrition.py             # 营养计算 + Agent 工具
├── nutrition.db                 # 食物营养数据库
├── .env.example                 # 环境变量模板
├── pyproject.toml               # 项目依赖
└── test_agent.py                # 16 个测试用例
```

## 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/chat?message=&user_id=` | SSE 流式对话 |
| GET | `/api/sessions` | 会话列表 |
| GET | `/api/sessions/:id` | 会话详情 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/identify-food` | CLIP 食物识别 |
| POST | `/api/calculate-intake` | 按克数算营养 |

## Agent 工具

| 工具 | 数据源 | 功能 |
|------|--------|------|
| `lookup_food_nutrition` | nutrition.db | 查食物每100g营养 |
| `get_user_profile` | Go 后端 | 查用户档案（过敏原、目标等） |
| `get_diet_history` | Go 后端 | 查某天饮食记录 |

## Agent Loop 流程

```
用户消息 → LLM 流式推理
  ├── chunk token → 实时 SSE 推送
  ├── tool_call → 执行工具 → 结果追加到对话 → 继续 LLM
  └── done → 对话保存到 agent.db
```

## Chinese-CLIP

模型：OFA-Sys/chinese-clip-vit-base-patch16 (~400MB)

```python
from recognition.multimodal import identify
results = identify(image_bytes, labels=["宫保鸡丁", "红烧肉", ...], top_k=5)
# → [{"name":"宫保鸡丁","confidence":0.73}, ...]
```

当前仅使用"家常菜"分类（510 条），可通过 `list_names(category="四川菜")` 切换。

## 测试

```bash
cd agent && uv run python test_agent.py
```

需要 Go 后端运行才能测试完整 Agent 工具链。
