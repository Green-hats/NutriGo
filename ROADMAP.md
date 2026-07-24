# NutriGo — 开发路线图

## 总览

| 阶段 | 名称 | 预计时间 | 核心产出 |
|------|------|---------|---------|
| 1 | Go 基础搭建 + 用户系统 | 第 1 周 | Go 项目骨架、用户注册/登录、JWT 认证 |
| 2 | Go CRUD 完善 | 第 1-2 周 | 健康档案、饮食记录、图片上传 |
| 3 | Python Agent 重构 | 第 2 周 | 将 AgentN 代码迁移重构，SSE 流式对话，营养工具 |
| 4 | 食物识别 + RAG 接入 | 第 3 周 | Chinese-CLIP 接入，ChromaDB 营养知识库 |
| 5 | Go + Python 联调 | 第 3 周 | 两服务互通，内部 API 调用跑通 |
| 6 | 前端开发 | 第 3-4 周 | 注册/登录页、对话页、饮食记录页、拍照识别 |
| 7 | 端到端联调 + 优化 | 第 4 周 | 全链路测试，问题修复，体验优化 |

---

## 阶段 1：Go 基础搭建 + 用户系统

### 目标
Go 项目能跑起来，用户能注册和登录。

### 任务清单

- [ ] 初始化 Go module，安装 Gin、GORM、golang-jwt 等依赖
- [ ] 搭建 Gin 路由骨架（`cmd/server/main.go`）
- [ ] 创建 User 数据模型（`internal/model/user.go`）
- [ ] 实现用户注册 handler（`POST /api/auth/register`）
  - [ ] 用户名/密码校验
  - [ ] bcrypt 密码哈希
  - [ ] 写入数据库
- [ ] 实现用户登录 handler（`POST /api/auth/login`）
  - [ ] 用户名/密码验证
  - [ ] 签发 JWT，返回 token
- [ ] JWT 认证中间件（`internal/middleware/jwt.go`）
- [ ] 内部服务鉴权中间件（`internal/middleware/internal_auth.go`）
- [ ] 编写健康检查路由（`GET /api/health`）
- [ ] 验证：用 curl/Postman 测试注册→登录→携带 token 访问受保护接口

### 学习目标（Go 新手）
- Go module 管理、项目结构风格
- Gin 路由、中间件、请求参数绑定
- GORM 模型定义、CRUD 基本操作
- bcrypt 哈希、JWT 签发与验证

### Go 依赖清单
```
github.com/gin-gonic/gin
gorm.io/gorm
gorm.io/driver/sqlite
github.com/golang-jwt/jwt/v5
golang.org/x/crypto
```

---

## 阶段 2：Go CRUD 完善

### 目标
用户画像、饮食记录、图片上传三个模块的完整 CRUD。

### 任务清单

- [ ] **用户画像**（UserProfile）
  - [ ] 数据模型 + 自动建表
  - [ ] `GET /api/users/:id/profile` — 获取
  - [ ] `PUT /api/users/:id/profile` — 更新
    - 身高、体重、年龄、性别、目标、过敏原、饮食习惯
- [ ] **图片上传**（FoodImage）
  - [ ] 数据模型 + 自动建表
  - [ ] `POST /api/images/upload` — 上传文件存储、UUID 重命名、写数据库
  - [ ] `GET /api/images/:id` — 获取 meta 信息
  - [ ] `GET /api/images/:id/data` — 返回图片二进制（给 Python 调用）
  - [ ] 文件类型校验、大小限制（10MB）
- [ ] **饮食记录**（FoodDiary）
  - [ ] 数据模型 + 自动建表
  - [ ] `POST /api/diet/logs` — 创建记录
  - [ ] `GET /api/diet/logs?date=2026-07-25` — 按日查询
  - [ ] `DELETE /api/diet/logs/:id` — 删除记录
- [ ] 验证：CRUD 全套用 curl/Postman 测试

### 学习目标
- GORM 关联查询（User → Profile → Diary）
- 文件上传处理（multipart/form-data）
- Gin 参数校验（binding tag）
- 分层架构实践（handler → service → repository）

---

## 阶段 3：Python Agent 重构

### 目标
将 AgentN 现有代码迁移到 NutriGo 项目，重构为 FastAPI 服务，支持 SSE 流式对话。

### 任务清单

- [ ] 初始化 Python 项目（`pyproject.toml`，保留 litellm 依赖，新增 FastAPI 等）
- [ ] 创建 FastAPI 入口（`agent/app/main.py`）
- [ ] **迁移 + 重构 llm_client.py**
  - [ ] 保留 Agent Loop 核心逻辑
  - [ ] 新增 `stream()` 方法 — 逐 token 返回（用 async generator）
- [ ] **迁移 tools.py**
  - [ ] 保留 `@tool` 装饰器机制
  - [ ] 移除原有文件/Shell 工具
  - [ ] 新增基础 Agent 工具桩（先空壳，阶段 4 实现）
- [ ] **迁移 conversation.py**
  - [ ] 保留会话状态 + 回滚
  - [ ] 适配 Web 场景（无需 print/input）
- [ ] **重构 chat_io.py**
  - [ ] 保留 `ChatIO` 抽象接口
  - [ ] 新增 `SSEChatIO` — 输出通过 async generator 传递给 FastAPI StreamingResponse
- [ ] **迁移 db.py**
  - [ ] 保留 sessions 表，新增 user_id 字段
- [ ] **新增 config.py** — 从 .env 读取配置
- [ ] 实现 SSE 对话路由（`GET /api/chat`）
- [ ] 验证：curl 测试 SSE 流式输出

### Python 新增依赖
```
fastapi
uvicorn
aiosqlite         # 如果 db.py 改异步
httpx             # 异步调 Go API
```

### 学习目标
- FastAPI 基础：路由、依赖注入、StreamingResponse
- SSE 协议实现（`text/event-stream`）
- 异步 Python（async/await 在 Agent Loop 中的应用）

---

## 阶段 4：食物识别 + RAG 接入

### 目标
接入 Chinese-CLIP 和 ChromaDB，实现食物识别和知识检索。

### 任务清单

- [ ] **创建 multimodal.py**
  - [ ] 加载 Chinese-CLIP 模型（OFA-Sys/chinese-clip-vit-base-patch16）
  - [ ] 维护食物名称列表（200+ 常见中国菜品/食材）
  - [ ] 实现 `identify(image_bytes) → [{name, confidence}, ...]`
- [ ] **创建 rag.py**
  - [ ] 初始化 ChromaDB 客户端
  - [ ] 实现文档加载与 embedding（中国膳食指南等）
  - [ ] 实现 `query(question) → [相关文档段落]`
- [ ] **创建 food_api.py**
  - [ ] 封装 USDA FoodData Central API 调用
  - [ ] 封装 OpenFoodFacts API 调用
  - [ ] 统一返回格式 `{calories, protein, fat, carbs, ...}`
- [ ] **创建 nutrition_tools.py**
  - [ ] `lookup_food_nutrition(food_name)` — 查询营养成分
  - [ ] `search_nutrition_knowledge(query)` — RAG 知识检索
  - [ ] `get_user_profile(user_id)` — 调 Go API
  - [ ] `get_diet_history(user_id, date)` — 调 Go API
- [ ] **创建 go_client.py**
  - [ ] 封装对 Go 服务的 HTTP 调用
  - [ ] 内部鉴权（携带 internal_token）
  - [ ] `get_image_data(image_id) → bytes`
  - [ ] `get_user_profile(user_id) → dict`
  - [ ] `get_diet_logs(user_id, date) → list`
- [ ] 实现识别路由（`POST /api/identify-food`）
  - [ ] 接收 image_id → 调 Go 拿图片 → CLIP 识别 → 返回结果
- [ ] 验证：传一张食物图片，验证识别结果合理性

### 新增依赖
```
chromadb
transformers
torch (或 onnxruntime 做轻量推理)
pillow
```

### 学习目标
- HuggingFace transformers 基础使用
- CLIP 模型原理与零样本分类
- ChromaDB 的 collection 管理和检索
- Python 异步 HTTP 客户端（httpx）

---

## 阶段 5：Go + Python 联调

### 目标
两个服务联调通过，完整链路跑通。

### 任务清单

- [ ] Go 添加内部鉴权中间件，校验 `X-Internal-Token`
- [ ] Python 的 `go_client.py` 在所有调用中携带 internal_token
- [ ] 集成测试：模拟用户完整使用流程
  - [ ] 注册 → 登录
  - [ ] 填写健康档案
  - [ ] 上传食物图片 → 识别 → 添加到饮食记录
  - [ ] 发起对话 → Python 调 Go 拿用户画像 → SSE 返回建议
- [ ] 错误处理：Go 不可用时 Python 不崩溃，返回友好错误
- [ ] 验证：全链路手动测试通过

### 学习目标
- 微服务间通信模式
- 错误处理和超时控制
- 跨服务调试技巧

---

## 阶段 6：前端开发

### 目标
React 前端完成核心页面。

### 任务清单

- [ ] **项目初始化**
  - [ ] Vite + React + TypeScript 脚手架
  - [ ] 安装 shadcn-ui、TailwindCSS、Zustand、React Router
- [ ] **Auth 页面**
  - [ ] 登录页（`/login`）
  - [ ] 注册页（`/register`）
  - [ ] 路由守卫：未登录跳转登录页
- [ ] **Chat 页面**（首页）
  - [ ] SSE 连接管理（`EventSource`）
  - [ ] 消息列表渲染（Markdown 支持）
  - [ ] 输入框 + 发送
  - [ ] 流式逐字展示回复
- [ ] **Diet Diary 页面**
  - [ ] 日期选择器
  - [ ] 当日饮食记录列表
  - [ ] 添加物品入口（手动输入 / 拍照识别）
- [ ] **拍照识别流程**
  - [ ] 摄像头拍照或文件选择
  - [ ] 上传到 Go → 拿到 image_id
  - [ ] 调 Python 识别 → 展示候选列表
  - [ ] 用户确认 + 标注份量 → 写入 Go
- [ ] **Profile 页面**
  - [ ] 健康档案表单
  - [ ] 查看/编辑
- [ ] **API 层封装** (`src/api/`)
  - [ ] `goApi.ts` — 调用 Go REST 接口（带 JWT）
  - [ ] `agentApi.ts` — 调 Python REST 接口 + SSE 连接管理
- [ ] **状态管理** (Zustand)
  - [ ] `authStore` — 用户信息、token
  - [ ] `chatStore` — 对话消息、session

### 前端依赖
```
@typescript-eslint/parser
react-router-dom
zustand
tailwindcss
@shadcn/ui (通过 npx 安装)
lucide-react (图标)
```

### 学习目标（如果前端经验较少）
- Vite + React + TypeScript 项目搭建
- TailwindCSS 工具类样式
- shadcn-ui 组件使用
- Zustand 状态管理
- EventSource (SSE) 的使用

---

## 阶段 7：端到端联调 + 优化

### 目标
全链路跑通，修复问题，优化体验。

### 任务清单

- [ ] 三服务同时启动，端到端测试所有功能
- [ ] 修复发现的 Bug
- [ ] 错误状态覆盖：网络异常、模型推理失败、空数据等
- [ ] 对话历史持久化验证（退出后恢复）
- [ ] 性能优化：图片压缩、模型推理缓存、ChromaDB 预加载
- [ ] 补充前端 loading / empty / error 状态
- [ ] TypeScript 类型覆盖率检查
- [ ] 编写 README：如何启动、如何开发

---

## 开发顺序建议

```
阶段 1（Go 用户）  ──→  阶段 2（Go CRUD）
                               │
阶段 3（Python 重构）──────→ 阶段 4（识别+RAG）
                               │
                         阶段 5（联调）
                               │
                         阶段 6（前端）
                               │
                         阶段 7（端到端）
```

阶段 1-2 和阶段 3-4 可以并行推进（Go 和 Python 独立开发），到阶段 5 合并。

---

## 环境准备清单

### 开发工具

| 工具 | 用途 | 安装方式 |
|------|------|---------|
| Go 1.22+ | Go 开发 | [go.dev/dl](https://go.dev/dl/) |
| Python 3.13 | Python 开发 | 已有 |
| uv | Python 包管理 | 已有 |  
| Node.js 20+ | 前端开发 | [nodejs.org](https://nodejs.org/) |
| pnpm / npm | 前端包管理 | 随 Node.js 自带 |
| curl / Postman | API 测试 | 可选 |

### 模型下载

| 模型 | 大小 | 用途 |
|------|------|------|
| Chinese-CLIP (ViT-B-16) | ~400MB | 食物识别 |
| embedding 模型（litellm 调用） | API 调用 | RAG 文档向量化 |

### 营养知识文档（RAG 用）

建议收集的文档资源：
- 《中国居民膳食指南（2022）》
- 中国食物成分表（常见食材营养数据）
- 常见疾病饮食建议（糖尿病、高血压等）
