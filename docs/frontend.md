# 前端文档

## 概述

移动端优先的单页应用，提供拍照识别、AI 对话、饮食日记和健康档案管理。端口 **5173**。

技术栈：React 19 + TypeScript + Vite + TailwindCSS + Zustand

## 启动

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd frontend && npm run dev
# 或
cd NutriGo && ./start.sh
```

## 目录结构

```
frontend/src/
├── main.tsx                    # React 入口
├── App.tsx                     # 路由 + Toast
├── index.css                   # Tailwind + Markdown 样式
├── types/index.ts              # TypeScript 类型定义
├── stores/
│   ├── auth.ts                 # Zustand: token, userInfo (持久化)
│   └── chat.ts                 # Zustand: messages, sessionId, toolResults
├── api/
│   ├── go.ts                   # Go REST (自动带 JWT + userId)
│   ├── agent.ts                # Python REST
│   └── sse.ts                  # SSE 直连 :8000（真流式）
├── components/
│   ├── ui/
│   │   ├── LoadingButton.tsx   # 按钮 + spinner
│   │   ├── Toast.tsx           # 顶部滑入通知（error/success）
│   │   ├── ErrorBlock.tsx      # 错误 + 重试
│   │   ├── Skeleton.tsx        # 灰色占位块
│   │   └── ChatErrorBoundary.tsx # 崩溃边界
│   ├── layout/
│   │   ├── AppLayout.tsx       # 底部导航壳
│   │   ├── BottomNav.tsx       # 3 个 Tab（对话/日记/我的）
│   │   └── ProtectedRoute.tsx  # 路由守卫
│   ├── chat/
│   │   └── HistorySidebar.tsx  # 会话历史列表
│   └── diary/
│       └── NutritionChart.tsx  # recharts 柱状图（7/14/30天）
├── pages/
│   ├── Login.tsx               # 登录（LoadingButton）
│   ├── Register.tsx            # 注册（LoadingButton）
│   ├── Chat.tsx                # SSE 流式对话 + 工具展示 + 历史
│   ├── Diary.tsx               # 日期选择 + 5步拍照流程 + 图表
│   └── Profile.tsx             # 档案表单 + 骨架屏
└── pages/
```

## 页面路由

| 路径 | 页面 | 认证 | 功能 |
|------|------|------|------|
| `/login` | 登录 | 无 | 用户名密码登录 |
| `/register` | 注册 | 无 | 注册新账号 |
| `/chat` | AI 对话 | JWT | SSE 流式对话 + 工具调用 + 历史会话 |
| `/diary` | 饮食日记 | JWT | 日期选择 + 拍照识别 + 营养趋势图 |
| `/profile` | 健康档案 | JWT | 身高/体重/目标/过敏原表单 |

## 状态管理

### authStore（持久化到 localStorage）

```typescript
{ token: string, user: { id, username }, profile: UserProfile }
```

API 层自动注入：
- `go.ts` 自动从 authStore 取 token 加 `Authorization` 头
- `go.ts` 自动从 authStore 取 userId 拼到 profile 路径
- `Chat.tsx` 自动从 authStore 取 userId 传给 SSE

### chatStore

```typescript
{ messages: ChatMessage[], sessionId: number, isStreaming: boolean }
```

`appendToLast` 处理流式场景：最后一条是 `assistant` 则追加，否则新建。
`updateToolResult` 按 toolName 匹配更新对应工具消息卡片。

## 拍照识别流程（5 步进度条）

```
📷 拍/选图 → 🔍 识别(510道菜) → 📋 选候选 → ⚖️ 调克数 → ✅ 保存
```

特色：
- 5 步进度条，每步有视觉反馈
- 克数输入 500ms debounce 防抖
- 营养估算 Loading 骨架屏
- 保存中旋转动画 + 摘要卡片
- 失败 Toast 提示 + 可重新拍照

## SSE 流式对话

- `EventSource` 直连 Python `:8000/api/chat`
- 流式输出中渲染纯文本（快），结束后自动切换 ReactMarkdown
- 工具调用显示折叠卡片 `<details>`，可展开查看返回值
- `ChatErrorBoundary` 捕获崩溃，显示错误+重试

## 交互规范

| 场景 | 方案 | 组件 |
|------|------|------|
| API 等待 | 按钮旋转 + 禁用 | `LoadingButton` |
| API 错误 | 顶部滑入通知，3 秒消失 | `Toast` |
| 网络错误 | 图标 + 消息 + 重试按钮 | `ErrorBlock` |
| 数据加载 | 灰色占位块 | `Skeleton` |
| 数据为空 | 图标 + 引导文案 + 行动按钮 | 页面内嵌 |
| 组件崩溃 | 错误信息 + 重试 | `ChatErrorBoundary` |

## 依赖

| 生产依赖 | 用途 |
|----------|------|
| react + react-dom | 框架 |
| react-router-dom | 路由 |
| zustand | 状态管理 |
| lucide-react | 图标（20+ 种） |
| react-markdown | Markdown 渲染 |
| recharts | 营养趋势图表 |

| 开发依赖 | 用途 |
|----------|------|
| tailwindcss + @tailwindcss/vite | CSS 框架 |
| typescript | 类型检查 |
| vite | 构建工具 |
