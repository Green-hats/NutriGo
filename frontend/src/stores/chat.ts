import { create } from 'zustand'
import type { ChatMessage } from '../types'

interface ChatState {
  messages: ChatMessage[]
  sessionId: number | null
  isStreaming: boolean
  addMessage: (msg: ChatMessage) => void
  appendToLast: (text: string) => void
  setSessionId: (id: number) => void
  setStreaming: (v: boolean) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessionId: null,
  isStreaming: false,

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  appendToLast: (text) =>
    set((s) => {
      const msgs = [...s.messages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + text }
      } else {
        // 工具调用后第一个 chunk：创建新的 assistant 消息
        msgs.push({ role: 'assistant', content: text })
      }
      return { messages: msgs }
    }),

  setSessionId: (id) => set({ sessionId: id }),
  setStreaming: (v) => set({ isStreaming: v }),
  clearMessages: () => set({ messages: [], sessionId: null }),
}))
