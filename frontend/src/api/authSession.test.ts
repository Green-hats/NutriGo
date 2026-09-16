import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tryRefresh } from './authSession'
import { useAuthStore } from '../stores/auth'
import { deferred } from '../test/deferred'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.getState().logout()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tryRefresh 刷新令牌', () => {
  it.each(['logout', 'switch'])('刷新期间 %s 后丢弃旧账号令牌', async (action) => {
    useAuthStore.getState().setAuth('old', { id: 1, username: 'first' }, 'r1')
    const pending = deferred<Response>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const refresh = tryRefresh()
    useAuthStore.getState().logout()
    if (action === 'switch') useAuthStore.getState().setAuth('second', { id: 2, username: 'second' }, 'r2')
    pending.resolve(new Response(JSON.stringify({ token: 'old-refreshed', refresh_token: 'r1-new' })))
    expect(await refresh).toBe(false)
    expect(useAuthStore.getState().token).toBe(action === 'logout' ? null : 'second')
    expect(useAuthStore.getState().user?.id).toBe(action === 'logout' ? undefined : 2)
  })

  it('新账号不共享旧刷新请求，旧请求完成也不能清除新账号的并发护栏', async () => {
    useAuthStore.getState().setAuth('first', { id: 1, username: 'first' }, 'r1')
    const old = deferred<Response>()
    const current = deferred<Response>()
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const oldRefresh = tryRefresh()
    useAuthStore.getState().setAuth('second', { id: 2, username: 'second' }, 'r2')
    const newRefresh = tryRefresh()
    old.resolve(new Response(JSON.stringify({ token: 'first-new', refresh_token: 'r1-new' })))
    expect(await oldRefresh).toBe(false)
    const concurrent = tryRefresh()
    current.resolve(new Response(JSON.stringify({ token: 'second-new', refresh_token: 'r2-new' })))
    expect(await newRefresh).toBe(true)
    expect(await concurrent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useAuthStore.getState().token).toBe('second-new')
    expect(useAuthStore.getState().user?.id).toBe(2)
  })

  it('成功时更新令牌并返回 true', async () => {
    useAuthStore.getState().setAuth('old-token', { id: 1, username: 'u' }, 'refresh-abc')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'new-token', refresh_token: 'refresh-new' }),
    })

    const result = await tryRefresh()
    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({ body: JSON.stringify({ refresh_token: 'refresh-abc' }) })
    )
    const s = useAuthStore.getState()
    expect(s.token).toBe('new-token')
    expect(s.refreshToken).toBe('refresh-new')
  })

  it('无 refresh_token 时不发起请求并返回 false', async () => {
    useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })

    const result = await tryRefresh()
    expect(result).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('刷新失败（401）返回 false', async () => {
    useAuthStore.getState().setAuth('token', { id: 1, username: 'u' }, 'refresh-abc')
    fetchMock.mockResolvedValue({ ok: false })

    const result = await tryRefresh()
    expect(result).toBe(false)
  })

  it('并发调用共享同一个刷新请求', async () => {
    useAuthStore.getState().setAuth('token', { id: 1, username: 'u' }, 'refresh-abc')
    let resolveFetch: (v: Response) => void = () => {}
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve })
    )

    const p1 = tryRefresh()
    const p2 = tryRefresh()
    resolveFetch({ ok: true, json: async () => ({ token: 't', refresh_token: 'r' }) } as Response)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
