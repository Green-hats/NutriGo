import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  captured: { cb: undefined as AnyCb }
}))

vi.mock('../api/sse', () => ({
  createChatStream: (...args: AnyCb[]) => {
    mocks.createChatStream(...args)
    mocks.captured.cb = args[2]
    return { cancel: mocks.cancel }
  }
}))

vi.mock('../components/chat/HistorySidebar', () => ({
  default: () => <div data-testid="history-sidebar" />
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('remark-gfm', () => ({ default: () => null }))

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  useChatStore.getState().clearMessages()
  useChatStore.setState({ isStreaming: false, sessionId: null })
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  mocks.createChatStream.mockClear()
  mocks.cancel.mockClear()
  mocks.captured.cb = undefined
})

async function sendMessage(
  user: ReturnType<typeof userEvent.setup>,
  text: string
) {
  await user.type(screen.getByPlaceholderText('输入消息...'), text)
  await user.click(screen.getByRole('button', { name: '发送' }))
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
    expect(screen.getByText(/查询食物营养中.../)).toBeInTheDocument()

    act(() => {
      mocks.captured.cb.onToolResult(
        'lookup_food_nutrition',
        '米饭 每100g 热量 116 kcal'
      )
    })
    expect(screen.getByText(/查询食物营养 · 已完成/)).toBeInTheDocument()
    const details = screen.getByRole('button', { name: /查询食物营养 · 已完成 查看详情/ })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    await user.click(details)
    expect(screen.getByText('米饭 每100g 热量 116 kcal')).toBeVisible()
    expect(details).toHaveAttribute('aria-expanded', 'true')
    await user.click(details)
    await waitFor(() => expect(screen.queryByText('米饭 每100g 热量 116 kcal')).not.toBeInTheDocument())
  })

  it('健康档案和饮食记录详情分别展开，后续回复不会覆盖查询结果', async () => {
    const user = userEvent.setup()
    render(<Chat />)
    await sendMessage(user, '回顾我的饮食')
    act(() => {
      mocks.captured.cb.onToolCall('get_user_profile')
      mocks.captured.cb.onToolResult('get_user_profile', '身高：170 cm\n体重：65 kg')
      mocks.captured.cb.onToolCall('get_diet_history')
      mocks.captured.cb.onToolResult('get_diet_history', '早餐：燕麦 200g，热量 150 kcal')
      mocks.captured.cb.onChunk('这是饮食建议')
      mocks.captured.cb.onDone()
    })
    await user.click(screen.getByRole('button', { name: /查看健康档案.*查看详情/ }))
    expect(screen.getByText(/身高：170 cm/)).toBeVisible()
    expect(screen.queryByText(/早餐：燕麦/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /回顾饮食记录.*查看详情/ }))
    expect(screen.getByText(/早餐：燕麦/)).toBeVisible()
    expect(screen.getByText('这是饮食建议')).toBeVisible()
  })

  it('历史查询的空结果能展开，未完成的查询不持续显示加载状态', async () => {
    useChatStore.getState().setMessages([
      { role: 'tool', content: '', toolName: 'get_diet_history', toolResult: '' },
      { role: 'tool', content: '', toolName: 'get_user_profile' }
    ])
    const user = userEvent.setup()
    render(<Chat />)
    await user.click(screen.getByRole('button', { name: /回顾饮食记录.*查看详情/ }))
    expect(screen.getByText('本次查询未返回内容。')).toBeVisible()
    expect(screen.getByText('查看健康档案 · 未完成')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
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

    await waitFor(() =>
      expect(screen.queryByTitle('停止生成')).not.toBeInTheDocument()
    )
    expect(screen.getByTitle('重新生成')).toBeInTheDocument()
  })
})

it('断网发送保留草稿，恢复后手动重试原消息', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const user = userEvent.setup()
  render(<Chat />)
  await user.type(
    screen.getByRole('textbox', { name: '消息内容' }),
    '今天吃什么'
  )
  await user.click(screen.getByRole('button', { name: '发送' }))
  expect(mocks.createChatStream).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('当前没有网络')
  expect(screen.getByRole('textbox', { name: '消息内容' })).toHaveValue(
    '今天吃什么'
  )
  online.mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: '重试' }))
  expect(mocks.createChatStream.mock.calls[0][3]).toBe('今天吃什么')
  expect(
    useChatStore.getState().messages.filter((m) => m.role === 'user')
  ).toHaveLength(1)
})

it('已有会话的新消息未被服务器确认时，恢复草稿并重发，不生成上一条回复', async () => {
  useChatStore.getState().setSessionId(8)
  useChatStore.getState().setMessages([
    { role: 'user', content: '旧问题' },
    { role: 'assistant', content: '旧回复' }
  ])
  const user = userEvent.setup()
  render(<Chat />)
  await sendMessage(user, '新问题')
  act(() => mocks.captured.cb.onError('连接超时'))
  expect(screen.getByRole('textbox', { name: '消息内容' })).toHaveValue(
    '新问题'
  )
  expect(useChatStore.getState().messages).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: '重试' }))
  expect(mocks.createChatStream.mock.calls[1][3]).toBe('新问题')
  expect(mocks.createChatStream.mock.calls[1][4]).not.toBe('regenerate')
})
