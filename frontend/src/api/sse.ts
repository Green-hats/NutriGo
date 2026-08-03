const AGENT_URL = '/agent-api'

export interface SSECallbacks {
  onChunk: (text: string) => void
  onToolCall: (name: string) => void
  onToolResult: (name: string, result: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export function createChatStream(
  message: string,
  sessionId: number | null,
  callbacks: SSECallbacks
): EventSource {
  const params = new URLSearchParams({ message })
  if (sessionId) params.set('session_id', String(sessionId))
  const url = `${AGENT_URL}/chat?${params}`

  const es = new EventSource(url)

  es.addEventListener('chunk', (e: MessageEvent) => {
    callbacks.onChunk(e.data)
  })

  es.addEventListener('tool_call', (e: MessageEvent) => {
    try {
      const d = JSON.parse(e.data)
      callbacks.onToolCall(d.name)
    } catch {}
  })

  es.addEventListener('tool_result', (e: MessageEvent) => {
    try {
      const d = JSON.parse(e.data)
      callbacks.onToolResult(d.name, d.result)
    } catch {}
  })

  es.addEventListener('done', () => {
    callbacks.onDone()
    es.close()
  })

  es.addEventListener('error', (e: MessageEvent) => {
    if (e.data) {
      callbacks.onError(e.data)
    }
    es.close()
  })

  return es
}
