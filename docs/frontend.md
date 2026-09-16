# 前端文档

## 概述

Tauri 2 手机 App 的 React 界面，提供拍照识别、AI 对话、饮食日记和健康档案。Android / iOS 工程位于 `frontend/src-tauri`，运行方式见 [手机 App 文档](MOBILE.md)。**5173** 仅为开发预览端口。

技术栈：Tauri 2 + Rust + React 19 + TypeScript + Vite + MUI 9 + Emotion + Zustand

## 界面规范

采用森林绿主色、暖白背景、统一的圆角和间距；样式通过 `theme.ts` 与 MUI `sx` 管理。三个底部导航保留对话、日记和档案结构，拍照识别与趋势使用全屏 Dialog，会话历史使用 Drawer。日记只展示真实记录合计；趋势分别显示热量与克数，不混用单位。图表和主页面按需加载。

输入框保持 16px 字号、图标操作至少 44px 触控范围，弹窗使用 MUI 焦点管理；支持安全区、可视窗口高度调整和减少动画偏好。最低要求为 iOS 17 / Chromium WebView 117。

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
├── theme.ts                    # MUI 主题、配色、圆角、触控尺寸
├── index.css                   # 安全区、键盘适配与 Markdown 样式
├── types/index.ts              # TypeScript 类型定义
├── stores/
│   ├── auth.ts                 # Zustand: token, refreshToken, user 持久化；profile 仅内存
│   └── chat.ts                 # Zustand: messages, sessionId, isStreaming
├── api/
│   ├── config.ts               # 云端 API 地址校验与路径拼接
│   ├── http.ts                 # 原生 HTTP 插件 / 浏览器 fetch 适配
│   ├── go.ts                   # Go REST (自动带 JWT + 401 自动刷新)
│   ├── agent.ts                # Python REST (自动带 JWT + 401 自动刷新)
│   ├── authSession.ts          # 刷新令牌换取新令牌（并发护栏）+ 登出
│   └── sse.ts                  # fetch + ReadableStream 解析 SSE（带 JWT）
├── components/
│   ├── ui/
│   │   ├── LoadingButton.tsx   # 按钮 + spinner
│   │   ├── Toast.tsx           # MUI Alert 通知（error/success）
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
│   ├── Chat.tsx                # SSE 流式对话 + 思考面板 + 工具展示 + 历史
│   ├── Diary.tsx               # 日期选择 + 5步拍照流程 + 图表
│   └── Profile.tsx             # 档案表单 + 骨架屏
└── test/
    └── setup.ts                # vitest 环境配置（jsdom + jest-dom）
```

## 页面路由

使用 HashRouter，安装包中的地址形如 `#/chat`，不依赖服务器页面回退。

| 路径 | 页面 | 认证 | 功能 |
|------|------|------|------|
| `/login` | 登录 | 无 | 用户名密码登录 |
| `/register` | 注册 | 无 | 注册新账号 |
| `/chat` | AI 对话 | JWT | SSE 流式对话 + 工具调用 + 历史会话 |
| `/diary` | 饮食日记 | JWT | 日期选择 + 拍照识别 + 营养趋势图 |
| `/profile` | 健康档案 | JWT | 身高/体重/目标/过敏原/基础病表单 |

## 状态管理

### authStore

仅 token、refreshToken、user 按 API 地址隔离后持久化到 localStorage，profile 留在内存；登录与登出均清空会话状态。目前尚未接入 Keychain / Keystore。

```typescript
{ token: string, refreshToken: string, user: { id, username }, profile: UserProfile }
```

API 层自动注入：
- `go.ts` / `agent.ts` 自动从 authStore 取 token 加 `Authorization` 头
- `go.ts` 自动从 authStore 取 userId 拼到 profile 路径
- **401 自动刷新**：请求遇 401 时，`authSession.ts` 用 `refresh_token` 换新令牌并重试一次；
  并发 401 共享同一个刷新请求；凭证无效才清登录态，断网或服务临时故障保留登录态
- `Chat.tsx` 自动从 authStore 取 token 传给 SSE（`user_id` 由后端从 JWT 解出，不再传 URL 参数）
- 登出会先调用后端 `/api/auth/logout` 吊销令牌，再清理本地状态

### chatStore

```typescript
{ messages: ChatMessage[], sessionId: number, isStreaming: boolean }
```

`appendToLast` 处理流式场景：最后一条是 `assistant` 则追加，否则新建。
`appendThinkingToLast` 把思维链流式追加到最后一条 assistant 消息的 `thinking` 字段。
`updateToolResult` 按 toolName 匹配更新对应工具消息卡片。

`ChatMessage` 结构：
```typescript
{ role: 'user' | 'assistant' | 'tool', content: string,
  toolName?: string, toolResult?: string, thinking?: string }
```

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

- `sse.ts` 用 `fetch` + `ReadableStream` 解析 SSE，连接 Python `/agent-api/chat`（经 Vite 代理到 :8000）
- 使用 fetch 而非 `EventSource` 的原因：`EventSource` 无法自定义 `Authorization` 头，而对话接口要求 JWT
- 返回 `{ cancel }` 句柄，可手动中断连接
- 监听 5 类事件：

| 事件 | 处理 |
|------|------|
| `thinking` | 折叠面板「分析过程」展示模型返回的推理摘要 |
| `chunk` | ReactMarkdown 渲染，流式输出时追加光标 |
| `tool_call` / `tool_result` | 自然语言状态提示，展示处理中或完成状态 |
| `done` / `error` | 收尾 / 错误提示 |

- 思维链仅在模型返回 `reasoning_content` 时出现，无思维链时面板自动隐藏
- `ChatErrorBoundary` 捕获崩溃，显示错误+重试

## 交互规范

| 场景 | 方案 | 组件 |
|------|------|------|
| API 等待 | 按钮旋转 + 禁用 | `LoadingButton` |
| API 错误 | 顶部提示，3.5 秒消失 | `Toast` |
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
| @mui/material + @emotion/react + @emotion/styled | 组件、主题与样式 |
| @mui/icons-material | Material Rounded 图标 |
| react-markdown | Markdown 渲染 |
| recharts | 营养趋势图表 |

| 开发依赖 | 用途 |
|----------|------|
| typescript | 类型检查 |
| vite | 构建工具 |
| vitest + jsdom | 单元测试 |
| @testing-library/react + user-event + jest-dom | 组件测试 |
| oxlint | 代码检查 |

## 测试

```bash
cd frontend && npx vitest run
```

106 个用例（`*.test.ts/tsx`），覆盖：chat store 逻辑、Login 登录流程、Chat 流式渲染（SSE mock）、Diary 日记页、拍照识别流程（FoodFlow）、Profile 档案页、NutritionChart 图表、HistorySidebar 批量删除、刷新令牌逻辑、Android 安全区换算与键盘／旋转状态。
