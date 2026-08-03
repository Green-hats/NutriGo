import { create } from 'zustand'
import type { ChatMessage } from '../types'

interface ChatState {
  messages: ChatMessage[]
  sessionId: number | null
  isStreaming: boolean
  addMessage: (msg: ChatMessage) => void
  appendToLast: (text: string) => void
  updateToolResult: (toolName: string, result: string) => void
  setSessionId: (id: number) => void
  setStreaming: (v: boolean) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessionId: null,
  isStreaming: false,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendToLast: (text) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + text }
      } else {
        msgs.push({ role: 'assistant', content: text })
      }
      return { messages: msgs }
    }),

  updateToolResult: (toolName, result) =>
    set((s) => {
      const msgs = [...s.messages]
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'tool' && msgs[i].toolName === toolName) {
          msgs[i] = { ...msgs[i], toolResult: result }
          return { messages: msgs }
        }
      }
      // 找不到对应的 tool 消息，追加一个新的
      msgs.push({ role: 'tool', content: '', toolName, toolResult: result })
      return { messages: msgs }
    }),

  setSessionId: (id) => set({ sessionId: id }),
  setStreaming: (v) => set({ isStreaming: v }),
  clearMessages: () => set({ messages: [], sessionId: null }),
}))
