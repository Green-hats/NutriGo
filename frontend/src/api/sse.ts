const AGENT_URL = '/agent-api'

export interface SSECallbacks {
  onChunk: (text: string) => void
  onThinking: (text: string) => void
  onToolCall: (name: string) => void
  onToolResult: (name: string, result: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export interface ChatStreamHandle {
  cancel: () => void
}

/**
 * 用 fetch + ReadableStream 解析 SSE，支持自定义 Authorization 头。
 * 返回 { cancel }，可手动中断连接。
 */
export function createChatStream(
  message: string,
  sessionId: number | null,
  token: string | null,
  callbacks: SSECallbacks
): ChatStreamHandle {
  const params = new URLSearchParams({ message })
  if (sessionId) params.set('session_id', String(sessionId))
  const url = `${AGENT_URL}/chat?${params}`

  const controller = new AbortController()

  const run = async () => {
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        callbacks.onError(err.detail || `HTTP ${resp.status}`)
        return
      }

      if (!resp.body) {
        callbacks.onError('响应无内容')
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const handleEvent = (event: string, data: string) => {
        switch (event) {
          case 'chunk':
            callbacks.onChunk(data)
            break
          case 'thinking':
            callbacks.onThinking(data)
            break
          case 'tool_call':
            try { callbacks.onToolCall(JSON.parse(data).name) } catch {}
            break
          case 'tool_result':
            try {
              const d = JSON.parse(data)
              callbacks.onToolResult(d.name, d.result)
            } catch {}
            break
          case 'done':
            callbacks.onDone()
            controller.abort()
            break
          case 'error':
            if (data) callbacks.onError(data)
            controller.abort()
            break
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // SSE 事件以空行分隔
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          let event = 'message'
          let data = ''
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim() + '\n'
          }
          if (data) handleEvent(event, data.trimEnd())
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') callbacks.onError(e?.message || '连接中断')
    }
  }

  run()

  return { cancel: () => controller.abort() }
}
