import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createChatStream } from './sse'
import { useAuthStore } from '../stores/auth'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('./http', () => ({ apiFetch: fetch }))

const callbacks = () => ({
  onSessionId: vi.fn(), onChunk: vi.fn(), onThinking: vi.fn(), onToolCall: vi.fn(),
  onToolResult: vi.fn(), onDone: vi.fn(), onError: vi.fn(),
})

function response(...parts: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

beforeEach(() => {
  fetch.mockReset()
  useAuthStore.getState().logout()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
})
afterEach(() => vi.unstubAllEnvs())

it('云端 SSE 支持分片、保留空格、正常完成', async () => {
  fetch.mockResolvedValue(response('event: session_id\ndata: 12\n\nevent: chu', 'nk\ndata: hello \n\nevent: done\ndata: \n\n'))
  const events = callbacks()
  createChatStream(null, 'access', events, '今天吃什么')
  await vi.waitFor(() => expect(events.onDone).toHaveBeenCalledOnce())
  expect(fetch.mock.calls[0][0]).toContain('https://api.example.com/agent-api/chat?message=')
  expect(events.onSessionId).toHaveBeenCalledWith(12)
  expect(events.onChunk).toHaveBeenCalledWith('hello ')
  expect(events.onError).not.toHaveBeenCalled()
})

it('App 恢复后令牌过期时刷新并重新打开流', async () => {
  useAuthStore.getState().setAuth('expired', { id: 7, username: 'user' }, 'refresh-old')
  fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'fresh', refresh_token: 'refresh-new' })))
    .mockResolvedValueOnce(response('event: done\ndata: \n\n'))
  const events = callbacks()
  createChatStream(12, 'expired', events, undefined, 'regenerate')
  await vi.waitFor(() => expect(events.onDone).toHaveBeenCalledOnce())
  expect(fetch.mock.calls[1][0]).toBe('https://api.example.com/api/auth/refresh')
  expect(fetch.mock.calls[2][0]).toBe('https://api.example.com/agent-api/sessions/12/regenerate')
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer fresh' } })
})

it('取消原生请求时不显示断线错误', async () => {
  fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Request cancelled')))
  }))
  const events = callbacks()
  const handle = createChatStream(null, 'access', events, 'hello')
  handle.cancel()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  expect(events.onError).not.toHaveBeenCalled()
})
