import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../stores/chat'
import { useAuthStore } from '../stores/auth'
import { createChatStream } from '../api/sse'
import type { ChatStreamHandle } from '../api/sse'
import { Loader2, History, Plus, Square, RotateCcw } from 'lucide-react'
import { ChatErrorBoundary } from '../components/ui/ChatErrorBoundary'
import HistorySidebar from '../components/chat/HistorySidebar'
import type { ChatMessage } from '../types'

const QUICK_CHIPS = ['分析我今天吃什么', '推荐午餐', '这个有多少热量', '帮我算BMI']

export default function Chat() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<ChatStreamHandle | null>(null)
  const { messages, addMessage, appendToLast, appendThinkingToLast, updateToolResult, setMessages, setSessionId, sessionId, isStreaming, setStreaming, clearMessages, truncateToLastUser } = useChatStore()
  const token = useAuthStore((s) => s.token)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = (text: string) => {
    const msg = text.trim()
    if (!msg || isStreaming) return
    setInput('')
    setError('')
    addMessage({ role: 'user', content: msg })
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)

    const handle = createChatStream(sessionId, token, {
      onSessionId: (id) => setSessionId(id),
      onChunk: (t) => appendToLast(t),
      onThinking: (t) => appendThinkingToLast(t),
      onToolCall: (name) => addMessage({ role: 'tool', content: '', toolName: name }),
      onToolResult: (name, result) => updateToolResult(name, result),
      onDone: () => { setStreaming(false); streamRef.current = null },
      onError: (err) => { setError(err); setStreaming(false); streamRef.current = null },
    }, msg)
    streamRef.current = handle
  }

  const stop = () => {
    streamRef.current?.cancel()
    streamRef.current = null
    setStreaming(false)
  }

  const regenerate = () => {
    if (!sessionId || isStreaming) return
    setError('')
    // 前端先回滚到最后一条 user（与后端 rollback 保持一致），再补一个空 assistant 让流式填充
    truncateToLastUser()
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)

    const handle = createChatStream(sessionId, token, {
      onSessionId: (id) => setSessionId(id),
      onChunk: (t) => appendToLast(t),
      onThinking: (t) => appendThinkingToLast(t),
      onToolCall: (name) => addMessage({ role: 'tool', content: '', toolName: name }),
      onToolResult: (name, result) => updateToolResult(name, result),
      onDone: () => { setStreaming(false); streamRef.current = null },
      onError: (err) => { setError(err); setStreaming(false); streamRef.current = null },
    }, undefined, 'regenerate')
    streamRef.current = handle
  }

  const handleHistorySelect = (id: number, msgs: ChatMessage[]) => {
    setMessages(msgs)
    setSessionId(id)
    setShowHistory(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] relative">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold relative">
        <button onClick={() => setShowHistory(true)} className="absolute left-4 top-1/2 -translate-y-1/2"><History size={22} /></button>
        NutriGo AI 营养师
        <button onClick={clearMessages} title="新建会话" className="absolute right-4 top-1/2 -translate-y-1/2"><Plus size={24} /></button>
      </div>
      {showHistory && <HistorySidebar onSelect={handleHistorySelect} onClose={() => setShowHistory(false)} />}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <ChatErrorBoundary>
        {messages.length === 0 && (
          <div className="flex flex-col items-center mt-16">
            <p className="text-5xl mb-4">🍎</p>
            <p className="text-gray-400 mb-6">告诉我你吃了什么，或拍照记录~</p>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_CHIPS.map((c) => (
                <button key={c} onClick={() => send(c)} className="bg-green-50 text-green-700 rounded-full px-4 py-2 text-sm hover:bg-green-100 transition-colors">{c}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' && (
              <div className="flex justify-end"><div className="bg-green-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%] text-sm">{msg.content}</div></div>
            )}
            {msg.role === 'assistant' && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 max-w-[88%] text-sm markdown-body">
                  {msg.thinking && (
                    <details className="mb-2 text-xs">
                      <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">🤔 思考过程</summary>
                      <p className="mt-1 whitespace-pre-wrap text-gray-400 border-t border-gray-200 pt-2">{msg.thinking}</p>
                    </details>
                  )}
                  {msg.content ? (
                    <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                      {msg.content + (isStreaming && i === messages.length - 1 ? '▍' : '')}
                    </ReactMarkdown>
                  ) : (
                    isStreaming && i === messages.length - 1 && (
                      <span className="flex items-center gap-2 text-gray-400"><Loader2 size={14} className="animate-spin" />思考中...</span>
                    )
                  )}
                </div>
                {msg.content && !isStreaming && i === messages.length - 1 && sessionId && (
                  <button onClick={regenerate} title="重新生成"
                    className="ml-2 self-start text-gray-400 hover:text-green-600 transition-colors shrink-0">
                    <RotateCcw size={16} />
                  </button>
                )}
              </div>
            )}
            {msg.role === 'tool' && (
              <div className="flex justify-start">
                <div className={`rounded-xl px-3 py-2 text-xs ${msg.toolResult ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}>
                  {msg.toolResult ? (
                    <details>
                      <summary className="cursor-pointer">✅ {msg.toolName} 已完成</summary>
                      <p className="mt-1 whitespace-pre-wrap">{msg.toolResult.slice(0, 300)}</p>
                    </details>
                  ) : (
                    <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 正在调用：{msg.toolName}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 max-w-[88%]">
              <p className="mb-2">❌ {error}</p>
              <button onClick={() => setError('')} className="text-red-500 text-xs underline">关闭</button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
        </ChatErrorBoundary>
      </div>

      <div className="border-t px-4 py-3 bg-white">
        <div className="flex gap-2">
          <input
            className="flex-1 border border-gray-200 rounded-full px-4 py-2.5 text-sm outline-none focus:border-green-500"
            placeholder="输入消息..."
            maxLength={2000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
          />
          {isStreaming ? (
            <button onClick={stop} title="停止生成"
              className="bg-red-500 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-red-600 transition-colors">
              <Square size={16} className="fill-current" />
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={isStreaming}
              className="bg-green-600 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-700 transition-colors disabled:opacity-50">➤</button>
          )}
        </div>
      </div>
    </div>
  )
}
