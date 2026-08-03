import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChatStore } from '../stores/chat'
import { createChatStream } from '../api/sse'

export default function Chat() {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const { messages, addMessage, appendToLast, sessionId, setSessionId, isStreaming, setStreaming } = useChatStore()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')

    addMessage({ role: 'user', content: text })
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)

    createChatStream(text, sessionId, {
      onChunk: (t) => appendToLast(t),
      onToolCall: (name) => addMessage({ role: 'tool', content: '', toolName: name }),
      onToolResult: (name, result) => {},
      onDone: () => setStreaming(false),
      onError: (err) => {
        appendToLast(`\n\n❌ ${err}`)
        setStreaming(false)
      },
    })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold">
        NutriGo AI 营养师
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-5xl mb-4">🍎</p>
            <p>告诉我你今天吃了什么，或者拍张照片~</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="bg-green-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%] text-sm">
                  {msg.content}
                </div>
              </div>
            )}
            {msg.role === 'assistant' && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3 max-w-[88%] text-sm markdown-body">
                  {msg.content ? (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  ) : (
                    isStreaming && i === messages.length - 1 && (
                      <span className="text-gray-400">思考中...</span>
                    )
                  )}
                </div>
              </div>
            )}
            {msg.role === 'tool' && (
              <div className="flex justify-start">
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-700">
                  🔧 正在调用：{msg.toolName}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t px-4 py-3 bg-white">
        <div className="flex gap-2">
          <input
            className="flex-1 border border-gray-200 rounded-full px-4 py-2.5 text-sm outline-none focus:border-green-500"
            placeholder="输入消息..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button
            onClick={send}
            disabled={isStreaming}
            className="bg-green-600 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
