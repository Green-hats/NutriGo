# NutriGo — 开发路线图

## 总览

| 阶段 | 名称 | 状态 |
|------|------|------|
| 1 | Go 基础搭建 + 用户系统 | ✅ 完成 |
| 2 | Go CRUD 完善 | ✅ 完成 |
| 3 | Python Agent 重构 | ✅ 完成 |
| 4 | 食物识别 + RAG 接入 | ✅ 完成 |
| 5 | Go + Python 联调 | ✅ 完成 |
| 6 | 前端开发 | ✅ 完成 |
| 7 | 端到端联调 + 优化 | ✅ 完成 |
| 8 | 文档 + 发布 | ✅ 完成 |

---

## 已完成功能清单

### Go 后端 (:3333)

| 功能 | 接口数 | 表数 |
|------|--------|------|
| 用户认证（注册/登录/JWT） | 2 | 1 |
| 健康档案 | 2 | 1 |
| 图片管理（上传/删除/内部获取） | 5 | 1 |
| 饮食记录（CRUD + 按日期查询） | 5 | 1 |
| 每日汇总（7天聚合 + 查询） | 1 | 1 |
| 后台任务（图片清理 + 记录聚合） | — | — |

### Python Agent (:8000)

| 功能 | 路由数 | 工具数 |
|------|--------|--------|
| SSE 流式对话 | 1 | — |
| 会话管理 | 3 | — |
| 食物图片识别 | 1 | — |
| 营养计算 | 1 | — |
| Agent 工具（查营养/查档案/查记录/搜知识） | — | 4 |
| ChromaDB RAG（2277 条教材文档） | — | — |
| 营养数据库（8407 条食物） | — | — |

### 前端 (:5173)

| 功能 | 页面数 |
|------|--------|
| 登录/注册（Loading/Error 状态） | 2 |
| AI 对话（SSE 流式 + 工具卡片 + 历史会话） | 1 |
| 饮食日记（5 步拍照流程 + 营养图表） | 1 |
| 健康档案（骨架屏 + 表单） | 1 |
| 交互规范（Toast/ErrorBlock/Skeleton/ChatErrorBoundary） | — |

---

## 数据流

```
用户拍照 → Go 存图 → Python CLIP 识别(510道家常菜) → 用户选菜 + 填克数
  → Python 计算营养 → Go 存饮食记录 → 用户 AI 对话
    → Agent Loop → 查 nutrition.db / 调 Go / 搜 ChromaDB → SSE 流式回复

数据生命周期：
  Day 1~7: 原始记录（food_diaries）
  Day 8+:  每日汇总（daily_summaries）+ 原记录删除 + 图片清理
```

## 数据库

| 数据库 | 位置 | 内容 |
|--------|------|------|
| `data.db` | backend/ | users, user_profiles, food_diaries, food_images, daily_summaries |
| `agent.db` | agent/ | sessions（对话历史） |
| `nutrition.db` | agent/ | 8407 条食物营养数据 |
| `chroma_db/` | agent/ | 2277 条向量化教材文档 |

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 / TypeScript / Vite / TailwindCSS / Zustand / recharts |
| Go 后端 | Gin / GORM / golang-jwt / SQLite |
| Python Agent | FastAPI / litellm / Chinese-CLIP / ChromaDB / BGE |

## 测试

| 层 | 用例数 | 命令 |
|----|--------|------|
| Go 后端 | 66 | `cd backend && python3 test_api.py` |
| Python Agent | 16 | `cd agent && uv run python test_agent.py` |
