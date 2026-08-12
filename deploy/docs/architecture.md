# NutriGo 部署架构

> 本文档描述的是作者个人部署方式的一种示例，仅作参考，不是通用推荐方案。
> 两台机器（前端节点 + 后端节点）的拓扑可根据实际资源合为一台，或改用云托管等。

## 拓扑

```
┌──────────────────────────────────────────────────────────────┐
│  前端节点 (Caddy 自动 HTTPS)                                   │
│  <your-domain> :443                                          │
│   ├── /            → 前端静态 (React dist)                    │
│   ├── /api         → 反代 → 后端节点 3333 (backend)           │
│   └── /agent-api   → 反代 → 后端节点 8000  (agent)            │
└──────────────────────────────┬───────────────────────────────┘
                               │ 公网
┌──────────────────────────────┴───────────────────────────────┐
│  后端节点 (Docker + swap)                                     │
│                                                              │
│   ┌─────────────────┐         ┌─────────────────────────────┐│
│   │ backend (Go)    │◄────────│ agent (FastAPI)             ││
│   │ Gin + SQLite    │ 内网     │ Chinese-CLIP + bge-small    ││
│   │ uploads/        │ :3333   │ ChromaDB + litellm          ││
│   │ :3333           │         │ :8000                       ││
│   └─────────────────┘         │     │                        ││
│                               │     └─► 外部 LLM API         ││
│                               └─────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

> 前端节点与后端节点可以部署在同一台服务器；分机部署时后端节点需开放 3333/8000 端口。

## 请求闭环

1. 用户打开 `https://<your-domain>`（前端节点）→ Caddy 返回前端静态页
2. 上传食物图片 → 前端 POST `/api/images/upload` → Caddy `/api` → 后端节点 backend 存图 `uploads/`
3. 触发识别 → 前端 POST `/agent-api/api/identify-food` → Caddy `/agent-api` → 后端节点 agent
4. agent 通过内网 `GO_BACKEND_URL=http://backend:3333` + `X-Internal-Token` 回取图片
5. agent 本地 Chinese-CLIP 识别 → 查 `nutrition.db` 营养/份量 → 返回 Top-5
6. 对话 → 前端 GET `/agent-api/api/chat`（SSE 流）→ agent → litellm 调外部 LLM API
7. 营养统计/档案 → 前端 `/api/*` → 后端节点 backend SQLite

## 关键设计

| 项 | 方案 | 理由 |
|---|---|---|
| 前端 API 路径 | 相对路径 `/api`、`/agent-api` | 经 Caddy 同源反代，**零 CORS 问题、前端零改动** |
| agent 回连 backend | 内网 `http://backend:3333` | 同机不走公网，省流量快 |
| LLM | 外部 API（litellm） | 无需本地大模型，低配 CPU 足够 |
| 图像识别 | Chinese-CLIP 本地 + **文本向量预计算** + int8 量化 | 识别 7s→~2-3s，常驻内存 -1G |
| Embedding | bge-small-zh 本地（100MB） | 2277 条知识库足够，无需 bge-m3 |
| torch | CPU-only 版 | 镜像体积减半，无 CUDA 依赖 |

## 性能优化（识别）

针对低配 CPU 服务器，`agent/recognition/multimodal.py` 已实现：

- **文本向量预计算缓存**：菜名固定，仅首次编码一次，识别只跑 vision encoder
- **int8 动态量化**：`quantize_dynamic` 量化 Linear 层，权重 fp32→int8
- **线程控制**：`torch.set_num_threads(2)` 匹配双核
- **关闭梯度**：全局 `torch.set_grad_enabled(False)`

## 数据持久化（Docker 命名卷）

| 卷 | 挂载点 | 内容 |
|---|---|---|
| `nutrigo-data` | backend `/app` | SQLite `data.db` + `uploads/` 图片 |
| `nutrigo-agent-data` | agent `/app/agent/data` | 会话 `agent.db` |
| `nutrigo-chroma` | agent `/app/agent/chroma_db` | RAG 向量库 |
| `nutrigo-models` | `/models` | 预下载的 CLIP + bge 模型缓存 |

## 资源需求

| 资源 | 建议 | 说明 |
|---|---|---|
| 后端 CPU | 2 核起步 | CLIP 推理，核数越多识别越快 |
| 后端内存 | 4G + swap | torch + CLIP 常驻约 2.5G |
| 后端磁盘 | 60G | 镜像 + 模型 + 数据卷 |
| 前端节点 | 1C1G | 静态 + 反代，极轻 |
| 带宽 | 5Mbps 起 | gzip 后前端 ~1-2MB |

## 可选扩展（暂不引入）

- **Milvus**：知识库 >10 万条时才需要，当前 2277 条用 ChromaDB 足够
- **Redis**：多实例会话共享时才需要
- **Jaeger**：链路追踪，单机部署阶段收益低
- **Ollama**：若想彻底脱离外部 LLM API，可加 ollama 服务 + `LLM_BASE_URL`
