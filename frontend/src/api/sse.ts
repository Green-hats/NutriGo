import { apiUrl } from './config'
import { apiFetch } from './http'
import { tryRefresh } from './authSession'
import { useAuthStore } from '../stores/auth'

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
      const params = new URLSearchParams({ message: message || '' })
      if (sessionId) params.set('session_id', String(sessionId))
      const regenerating = mode === 'regenerate' && sessionId !== null
      const path = regenerating ? `/sessions/${sessionId}/regenerate` : `/chat?${params}`
      const send = (accessToken: string | null) => apiFetch(apiUrl('agent', path), {
        method: regenerating ? 'POST' : 'GET',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      })
      let resp = await send(token)
      if (resp.status === 401 && !controller.signal.aborted && await tryRefresh()) {
        if (controller.signal.aborted) return
        resp = await send(useAuthStore.getState().token)
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
            else if (line.startsWith('data:')) {
              // SSE 只移除冒号后的一个可选空格，保留 token 空格和 Markdown 缩进。
              const value = line.slice(5)
              data += (value.startsWith(' ') ? value.slice(1) : value) + '\n'
            }
          }
          if (data) handleEvent(event, data.slice(0, -1))
          if (streamEndedNormally) return
        }
      }

      // 流读完了但没收到 done/error（网络中途断开）→ 提示连接中断
      if (!streamEndedNormally && !controller.signal.aborted) {
        callbacks.onError('连接已断开，回复可能不完整')
      }
    } catch (e) {
      const err = e as { name?: string; message?: string } | null
      if (!controller.signal.aborted && err?.name !== 'AbortError') callbacks.onError(err?.message || '连接中断')
    }
  }

  run()

  return { cancel: () => controller.abort() }
}
