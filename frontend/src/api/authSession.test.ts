import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tryRefresh } from './authSession'
import { useAuthStore } from '../stores/auth'

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
