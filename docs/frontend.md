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
│   └── chat.ts                 # Zustand: messages, sessionId
├── api/
│   ├── go.ts                   # Go REST (自动带 JWT)
│   ├── agent.ts                # Python REST
│   └── sse.ts                  # SSE EventSource（直连 :8000）
├── components/
│   ├── ui/
│   │   ├── LoadingButton.tsx   # 按钮 + spinner
│   │   ├── Toast.tsx           # 顶部滑入通知
│   │   ├── ErrorBlock.tsx      # 错误 + 重试
│   │   ├── Skeleton.tsx        # 灰色占位块
│   │   └── ChatErrorBoundary.tsx # 崩溃边界
│   ├── layout/
│   │   ├── AppLayout.tsx       # 底部导航壳
│   │   ├── BottomNav.tsx       # 3 个 Tab
│   │   └── ProtectedRoute.tsx  # 路由守卫
│   ├── chat/
│   │   └── HistorySidebar.tsx  # 会话历史
│   └── diary/
│       └── NutritionChart.tsx  # recharts 柱状图
└── pages/
    ├── Login.tsx               # 登录
    ├── Register.tsx            # 注册
    ├── Chat.tsx                # SSE 流式对话 + 工具展示
    ├── Diary.tsx               # 日期选择 + 拍照5步流程
    └── Profile.tsx             # 档案表单
```

## 页面路由

| 路径 | 页面 | 认证 |
|------|------|------|
| `/login` | 登录 | 无 |
| `/register` | 注册 | 无 |
| `/chat` | AI 对话 | JWT |
| `/diary` | 饮食日记 | JWT |
| `/profile` | 健康档案 | JWT |

## 状态管理

### authStore（持久化到 localStorage）

```typescript
{ token: string, user: { id, username }, profile: UserProfile }
setAuth(token, user) | setProfile(profile) | logout()
```

### chatStore

```typescript
{ messages: ChatMessage[], sessionId: number, isStreaming: boolean }
addMessage(msg) | appendToLast(text) | updateToolResult(name, result)
```

## 拍照识别流程（5 步）

```
📷 拍/选图 → 🔍 CLIP 识别(20s) → 📋 选候选 → ⚖️ 调克数(debounce) → ✅ 保存
```

每步有步骤条指示、Loading/Error/空状态覆盖，杜绝 `alert()` 弹窗。

## SSE 流式对话

- EventSource 直连 Python `:8000/api/chat`
- 流式输出中显示纯文本（快），结束后切换 ReactMarkdown
- 工具调用显示折叠卡片，可展开查看结果
- `ChatErrorBoundary` 防止白屏

## 依赖

| 生产依赖 | 用途 |
|----------|------|
| react + react-dom | 框架 |
| react-router-dom | 路由 |
| zustand | 状态管理 |
| lucide-react | 图标 |
| react-markdown | Markdown 渲染 |
| recharts | 图表 |

| 开发依赖 | 用途 |
|----------|------|
| tailwindcss + @tailwindcss/vite | CSS 框架 |
| typescript | 类型检查 |
| vite | 构建工具 |
