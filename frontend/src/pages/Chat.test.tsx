import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Chat from './Chat'
import { useChatStore } from '../stores/chat'
import { useAuthStore } from '../stores/auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCb = any

const mocks = vi.hoisted(() => ({
  createChatStream: vi.fn(),
  cancel: vi.fn(),
  captured: { cb: undefined as AnyCb },
}))

vi.mock('../api/sse', () => ({
  createChatStream: (...args: AnyCb[]) => {
    mocks.createChatStream(...args)
    mocks.captured.cb = args[2]
    return { cancel: mocks.cancel }
  },
}))

vi.mock('../components/chat/HistorySidebar', () => ({
  default: () => <div data-testid="history-sidebar" />,
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('remark-gfm', () => ({ default: () => null }))

beforeEach(() => {
  useChatStore.getState().clearMessages()
  useChatStore.setState({ isStreaming: false, sessionId: null })
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  mocks.createChatStream.mockClear()
  mocks.cancel.mockClear()
  mocks.captured.cb = undefined
})

async function sendMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText('输入消息...'), text)
  await user.click(screen.getByRole('button', { name: '➤' }))
  await waitFor(() => expect(mocks.createChatStream).toHaveBeenCalled())
}

describe('Chat 页面', () => {
  it('发送消息调用 createChatStream 并渲染用户消息', async () => {
    const user = userEvent.setup()
    render(<Chat />)
    await sendMessage(user, '你好')

    const args = mocks.createChatStream.mock.calls[0]
    expect(args[0]).toBeNull() // 初始无 sessionId
    expect(args[3]).toBe('你好')
    expect(screen.getByText('你好')).toBeInTheDocument()
  })

  it('流式 chunk 实时累积 assistant 回复', async () => {
    const user = userEvent.setup()
    render(<Chat />)
    await sendMessage(user, '你好')

    act(() => {
      mocks.captured.cb.onChunk('这是')
      mocks.captured.cb.onChunk('回复')
    })
    expect(screen.getByText(/这是回复/)).toBeInTheDocument()
  })

  it('工具调用先显示进行中卡片，完成后显示结果', async () => {
    const user = userEvent.setup()
    render(<Chat />)
    await sendMessage(user, '查热量')

    act(() => {
      mocks.captured.cb.onToolCall('lookup_food_nutrition')
    })
    expect(screen.getByText(/正在调用：lookup_food_nutrition/)).toBeInTheDocument()

    act(() => {
      mocks.captured.cb.onToolResult('lookup_food_nutrition', '米饭 每100g 热量 116 kcal')
    })
    expect(screen.getByText(/lookup_food_nutrition 已完成/)).toBeInTheDocument()
  })

  it('流结束后停止加载状态并显示重新生成按钮', async () => {
    const user = userEvent.setup()
    render(<Chat />)
    await sendMessage(user, '你好')

    expect(screen.getByTitle('停止生成')).toBeInTheDocument()
    act(() => {
      mocks.captured.cb.onSessionId(5)
      mocks.captured.cb.onChunk('完整回复')
      mocks.captured.cb.onDone()
    })

    await waitFor(() => expect(screen.queryByTitle('停止生成')).not.toBeInTheDocument())
    expect(screen.getByTitle('重新生成')).toBeInTheDocument()
  })
})
