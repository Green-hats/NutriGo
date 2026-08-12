import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../stores/chat'

describe('chat store', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages()
  })

  it('addMessage 追加用户消息', () => {
    useChatStore.getState().addMessage({ role: 'user', content: '你好' })
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual(expect.objectContaining({ role: 'user', content: '你好' }))
    expect(msgs[0].id).toBeGreaterThan(0) // 分配了稳定的 React key
  })

  it('appendToLast 追加到最后一条 assistant 消息', () => {
    const s = useChatStore.getState()
    s.addMessage({ role: 'user', content: 'q' })
    s.addMessage({ role: 'assistant', content: '' })
    s.appendToLast('苹果')
    s.appendToLast('热量')
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('苹果热量')
  })

  it('appendToLast 无 assistant 时新建一条', () => {
    useChatStore.getState().appendToLast('hello')
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('hello')
  })

  it('appendThinkingToLast 流式累积 thinking', () => {
    const s = useChatStore.getState()
    s.addMessage({ role: 'assistant', content: '' })
    s.appendThinkingToLast('思考')
    s.appendThinkingToLast('过程')
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.thinking).toBe('思考过程')
  })

  it('updateToolResult 按 toolName 匹配更新', () => {
    const s = useChatStore.getState()
    s.addMessage({ role: 'user', content: 'q' })
    s.addMessage({ role: 'tool', content: '', toolName: 'lookup_food_nutrition' })
    s.updateToolResult('lookup_food_nutrition', '苹果54kcal')
    const tool = useChatStore.getState().messages.at(-1)!
    expect(tool.toolResult).toBe('苹果54kcal')
  })

  it('updateToolResult 找不到时追加新 tool 消息', () => {
    useChatStore.getState().updateToolResult('unknown_tool', 'result')
    const last = useChatStore.getState().messages.at(-1)!
    expect(last.role).toBe('tool')
    expect(last.toolName).toBe('unknown_tool')
    expect(last.toolResult).toBe('result')
  })

  it('truncateToLastUser 回滚到最后一条 user 之后', () => {
    const s = useChatStore.getState()
    s.addMessage({ role: 'user', content: 'q1' })
    s.addMessage({ role: 'assistant', content: 'a1' })
    s.addMessage({ role: 'user', content: 'q2' })
    s.addMessage({ role: 'assistant', content: 'a2' })
    s.addMessage({ role: 'tool', content: '', toolName: 'x' })
    s.truncateToLastUser()
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(3) // q1, a1, q2
    expect(msgs[2].content).toBe('q2')
  })

  it('truncateToLastUser 无 user 消息时不变', () => {
    const s = useChatStore.getState()
    s.addMessage({ role: 'assistant', content: 'a' })
    s.truncateToLastUser()
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('setSessionId / setStreaming / clearMessages', () => {
    const s = useChatStore.getState()
    s.setSessionId(42)
    s.setStreaming(true)
    expect(useChatStore.getState().sessionId).toBe(42)
    expect(useChatStore.getState().isStreaming).toBe(true)
    s.clearMessages()
    expect(useChatStore.getState().sessionId).toBeNull()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})
