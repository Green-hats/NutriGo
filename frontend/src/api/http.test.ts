import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiFetch } from './http'
import { usePreviewStore } from '../lib/preview'
import { useAuthStore } from '../stores/auth'

const native = vi.hoisted(() => ({ isTauri: vi.fn(), fetch: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: native.fetch }))

beforeEach(() => {
  vi.clearAllMocks()
  native.isTauri.mockReturnValue(false)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
  usePreviewStore.getState().exit()
})

it('浏览器使用 fetch 并正确读取响应', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
  vi.stubGlobal('fetch', fetch)
  expect(await (await apiFetch('/api/health')).json()).toEqual({ ok: true })
  expect(fetch).toHaveBeenCalledWith(
    '/api/health',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  )
  expect(native.fetch).not.toHaveBeenCalled()
})

it('原生上传保留 FormData、认证头和可取消的信号，不退回浏览器网络', async () => {
  native.isTauri.mockReturnValue(true)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  native.fetch.mockResolvedValue(new Response('{}'))
  const body = new FormData()
  body.append('image', new File(['photo'], 'meal.jpg', { type: 'image/jpeg' }))
  const controller = new AbortController()
  const options = {
    method: 'POST',
    body,
    signal: controller.signal,
    headers: { Authorization: 'Bearer access' }
  }
  const response = await apiFetch(
    'https://api.example.com/api/images/upload',
    options
  )
  expect(native.fetch).toHaveBeenCalledWith(
    'https://api.example.com/api/images/upload',
    { ...options, signal: expect.any(AbortSignal) }
  )
  const signal = native.fetch.mock.calls[0][1].signal
  controller.abort()
  expect(signal.aborted).toBe(true)
  await response.body?.cancel()
  expect(fetch).not.toHaveBeenCalled()
})

it('原生开发把相对路径解析到 Vite 地址', async () => {
  native.isTauri.mockReturnValue(true)
  native.fetch.mockResolvedValue(new Response('{}'))
  await (await apiFetch('/agent-api/health')).text()
  expect(native.fetch).toHaveBeenCalledWith(
    `${window.location.origin}/agent-api/health`,
    expect.any(Object)
  )
})

it('没有网络时立即显示中文提示，不发送请求', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(apiFetch('/api/health')).rejects.toThrow('当前没有网络')
  expect(fetch).not.toHaveBeenCalled()
})

it('有网络但服务器不可达，提示检查连接而非误报无数据', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  )
  await expect(apiFetch('/api/health')).rejects.toThrow('暂时无法连接服务器')
})

it('连接超时会结束等待并取消底层请求', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockReturnValue(new Promise(() => {}))
  vi.stubGlobal('fetch', fetch)
  const rejected = expect(
    apiFetch('/api/health', { timeoutMs: 100 })
  ).rejects.toThrow('连接超时')
  await vi.advanceTimersByTimeAsync(100)
  await rejected
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
})

it('收到响应头但响应体停滞也会超时，避免一直转圈', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })))
  )
  const response = await apiFetch('/api/health', { timeoutMs: 100 })
  const rejected = expect(response.json()).rejects.toThrow('连接超时')
  await vi.advanceTimersByTimeAsync(100)
  await rejected
  expect(cancel).toHaveBeenCalled()
})

it('主动取消与网络故障区分，不产生误报的超时', async () => {
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
  const controller = new AbortController()
  const rejected = expect(
    apiFetch('/api/health', { signal: controller.signal })
  ).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
})

it('流持续输出时重置空闲计时，允许总时长超过单次超时', async () => {
  vi.useFakeTimers()
  let source!: ReadableStreamDefaultController<Uint8Array>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            source = c
          }
        })
      )
    )
  )
  const response = await apiFetch('/agent-api/chat', { timeoutMs: 100 })
  const reader = response.body!.getReader()
  for (let i = 0; i < 3; i++) {
    const next = reader.read()
    await vi.advanceTimersByTimeAsync(80)
    source.enqueue(new TextEncoder().encode('chunk'))
    expect((await next).done).toBe(false)
  }
  source.close()
  expect((await reader.read()).done).toBe(true)
})

it('预览模式不生成登录凭证、不访问网络，所有写操作明确拒绝', async () => {
  vi.stubEnv('MODE', 'preview')
  vi.stubEnv('VITE_ENABLE_PREVIEW', 'true')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  useAuthStore.getState().logout()
  usePreviewStore.getState().enter()
  const profile = await (await apiFetch('/api/users/0/profile')).json()
  expect(profile.height_cm).toBe(170)
  expect(useAuthStore.getState().token).toBeNull()
  await expect(
    apiFetch('/api/users/0/profile', { method: 'PUT' })
  ).rejects.toThrow('只展示示例数据')
  await expect(apiFetch('/agent-api/chat?message=hi')).rejects.toThrow(
    '只展示示例数据'
  )
  expect(fetch).not.toHaveBeenCalled()
  expect(native.fetch).not.toHaveBeenCalled()
  usePreviewStore.getState().exit()
  await expect(apiFetch('/api/users/0/profile')).rejects.toThrow('尚未连接云端')
})

it('正式构建不能进入预览或用示例数据代替失败请求', async () => {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_ENABLE_PREVIEW', 'true')
  usePreviewStore.getState().enter()
  expect(usePreviewStore.getState().active).toBe(false)
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetch)
  await expect(apiFetch('/api/users/0/profile')).rejects.toThrow(
    '暂时无法连接服务器'
  )
  expect(fetch).toHaveBeenCalledOnce()
})
