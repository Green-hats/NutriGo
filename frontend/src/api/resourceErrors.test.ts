import { beforeEach, expect, it, vi } from 'vitest'
import { agentApi } from './agent'
import { goApi } from './go'
import { useAuthStore } from '../stores/auth'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('./http', () => ({ apiFetch: fetch }))

beforeEach(() => {
  fetch.mockReset()
  useAuthStore.getState().setAuth('token', { id: 7, username: 'tester' }, 'refresh')
})

it('上传接口在网络请求前拒绝超过 10 MiB 的文件', async () => {
  const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', {
    type: 'image/jpeg',
  })
  await expect(goApi.uploadImage(file)).rejects.toThrow('照片超过 10 MiB')
  expect(fetch).not.toHaveBeenCalled()
})

it('保留照片配额和存储不足的服务端提示', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({
    code: 'RESOURCE_UNAVAILABLE',
    message: '服务器照片存储空间不足，请稍后重试',
  }), { status: 507, headers: { 'Content-Type': 'application/json' } }))
  await expect(goApi.uploadImage(new File(['x'], 'meal.jpg', { type: 'image/jpeg' })))
    .rejects.toThrow('服务器照片存储空间不足')
})

it('保留照片分析超时的重试提示', async () => {
  fetch.mockResolvedValue(new Response(JSON.stringify({
    detail: '照片分析超时，请稍后重试或手动记录。',
  }), { status: 504, headers: { 'Content-Type': 'application/json' } }))
  await expect(agentApi.analyzeMeal(12)).rejects.toThrow('照片分析超时')
})

it.each([
  [413, '请求内容过大'],
  [429, '操作过于频繁'],
])('网关返回非 JSON 的 %i 时仍显示中文可操作提示', async (status, message) => {
  fetch.mockResolvedValue(new Response('gateway rejection', { status }))
  await expect(goApi.uploadImage(new File(['x'], 'meal.jpg', { type: 'image/jpeg' })))
    .rejects.toThrow(message)
})
