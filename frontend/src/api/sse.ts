const AGENT_URL = '/agent-api'

export interface SSECallbacks {
  onSessionId: (sessionId: number) => void
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
 * mode='chat'：GET /api/chat?message=...；mode='regenerate'：POST /api/sessions/{id}/regenerate
 * 返回 { cancel }，可手动中断连接。
 */
export function createChatStream(
  sessionId: number | null,
  token: string | null,
  callbacks: SSECallbacks,
  message?: string,
  mode: 'chat' | 'regenerate' = 'chat'
): ChatStreamHandle {
  const controller = new AbortController()
  let streamEndedNormally = false

  const run = async () => {
    try {
      let resp: Response
      if (mode === 'regenerate' && sessionId) {
        resp = await fetch(`${AGENT_URL}/sessions/${sessionId}/regenerate`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        })
      } else {
        const params = new URLSearchParams({ message: message || '' })
        if (sessionId) params.set('session_id', String(sessionId))
        resp = await fetch(`${AGENT_URL}/chat?${params}`, {
          method: 'GET',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        })
      }

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
          case 'session_id':
            try { callbacks.onSessionId(Number(data)) } catch {}
            break
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
            streamEndedNormally = true
            callbacks.onDone()
            controller.abort()
            break
          case 'error':
            streamEndedNormally = true
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

      // 流读完了但没收到 done/error（网络中途断开）→ 提示连接中断
      if (!streamEndedNormally && !controller.signal.aborted) {
        callbacks.onError('连接已断开，回复可能不完整')
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') callbacks.onError(e?.message || '连接中断')
    }
  }

  run()

  return { cancel: () => controller.abort() }
}
