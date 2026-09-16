import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiFetch } from './http'

const native = vi.hoisted(() => ({ isTauri: vi.fn(), fetch: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: native.fetch }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

it('浏览器预览使用浏览器 fetch', async () => {
  native.isTauri.mockReturnValue(false)
  const fetch = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await apiFetch('/api/health')
  expect(fetch).toHaveBeenCalledWith('/api/health', undefined)
  expect(native.fetch).not.toHaveBeenCalled()
})

it('原生上传保留 FormData 和取消信号，不退回浏览器网络', async () => {
  native.isTauri.mockReturnValue(true)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  native.fetch.mockResolvedValue(new Response('{}'))
  const body = new FormData()
  body.append('image', new File(['photo'], 'meal.jpg', { type: 'image/jpeg' }))
  const controller = new AbortController()
  const options = { method: 'POST', body, signal: controller.signal, headers: { Authorization: 'Bearer access' } }
  await apiFetch('https://api.example.com/api/images/upload', options)
  expect(native.fetch).toHaveBeenCalledWith('https://api.example.com/api/images/upload', options)
  expect(fetch).not.toHaveBeenCalled()
})

it('原生开发把相对路径解析到 Vite 地址', async () => {
  native.isTauri.mockReturnValue(true)
  native.fetch.mockResolvedValue(new Response('{}'))
  await apiFetch('/agent-api/health')
  expect(native.fetch).toHaveBeenCalledWith(`${window.location.origin}/agent-api/health`, undefined)
})
