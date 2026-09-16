import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goApi } from './go'
import { agentApi } from './agent'
import { tryRefresh } from './authSession'
import { useAuthStore } from '../stores/auth'
import { deferred } from '../test/deferred'

const fetch = vi.hoisted(() => vi.fn())
vi.mock('./http', () => ({ apiFetch: fetch }))
const switchAccount = () => useAuthStore.getState().setAuth('second', { id: 2, username: 'second' }, 'r2')

beforeEach(() => {
  fetch.mockReset()
  useAuthStore.getState().setAuth('first', { id: 1, username: 'first' }, 'r1')
})
afterEach(() => useAuthStore.getState().logout())

describe.each([
  ['Go', () => goApi.getDietLogs('2026-09-16')],
  ['Agent', () => agentApi.getSessions()],
] as const)('%s 请求的账号隔离', (_name, request) => {
  it.each([200, 401])('旧请求返回 %s 不影响新账号，也不使用新账号重试', async (status) => {
    const pending = deferred<Response>()
    fetch.mockReturnValueOnce(pending.promise)
    const result = request()
    const rejected = expect(result).rejects.toThrow('登录状态已改变')
    switchAccount()
    pending.resolve(new Response('[]', { status }))
    await rejected
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().token).toBe('second')
  })

  it.each([200, 401])('旧刷新返回 %s 不会登出或覆盖新账号', async (status) => {
    const pending = deferred<Response>()
    fetch.mockResolvedValueOnce(new Response('{}', { status: 401 })).mockReturnValueOnce(pending.promise)
    const result = request()
    const rejected = expect(result).rejects.toThrow('登录状态已改变')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    switchAccount()
    pending.resolve(new Response(JSON.stringify({ token: 'first-new', refresh_token: 'r1-new' }), { status }))
    await rejected
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(useAuthStore.getState().token).toBe('second')
    expect(useAuthStore.getState().user?.id).toBe(2)
  })

  it('同一会话已刷新后，迟到的 401 直接使用新令牌重试', async () => {
    const pending = deferred<Response>()
    fetch.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'fresh', refresh_token: 'new-refresh' })))
      .mockResolvedValueOnce(new Response('[]'))
    const result = request()
    expect(await tryRefresh()).toBe(true)
    pending.resolve(new Response('{}', { status: 401 }))
    await result
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('当前会话刷新失败会清除登录状态', async () => {
    fetch.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(request()).rejects.toThrow('登录已过期')
    expect(useAuthStore.getState().token).toBeNull()
  })
})

it('登录接口的 401 不触发刷新或清除现有账号', async () => {
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: '密码错误' }), { status: 401 }))
  await expect(goApi.login('second', 'wrong-password')).rejects.toThrow('密码错误')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(useAuthStore.getState().token).toBe('first')
})
