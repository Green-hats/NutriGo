import { useAuthStore } from '../stores/auth'
import { apiUrl } from './config'
import { ConnectionError } from '../lib/connection'
import { apiFetch } from './http'

// 仅同一登录会话共享刷新请求，切换账号后不复用旧请求。
let refreshInFlight: {
  sessionVersion: number
  refreshToken: string
  promise: Promise<boolean>
} | null = null

export function assertSessionCurrent(sessionVersion: number): void {
  if (useAuthStore.getState().sessionVersion !== sessionVersion) {
    throw new Error('登录状态已改变，请重试')
  }
}

/**
 * 用 refresh_token 换取新令牌对并写入 store。
 * 成功返回 true；凭证无效返回 false。断网或服务临时故障会抛出错误，保留登录态。
 */
export async function tryRefresh(
  sessionVersion = useAuthStore.getState().sessionVersion
): Promise<boolean> {
  const { refreshToken, token } = useAuthStore.getState()
  if (
    !refreshToken ||
    !token ||
    useAuthStore.getState().sessionVersion !== sessionVersion
  )
    return false

  if (
    refreshInFlight?.sessionVersion === sessionVersion &&
    refreshInFlight.refreshToken === refreshToken
  ) {
    return refreshInFlight.promise
  }
  const promise = (async () => {
    try {
      const resp = await apiFetch(apiUrl('go', '/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      })
      if (resp.status >= 500 || resp.status === 429) {
        void resp.body?.cancel().catch(() => {})
        throw new ConnectionError('service')
      }
      if (!resp.ok) {
        void resp.body?.cancel().catch(() => {})
        return false
      }
      const data = await resp.json()
      const current = useAuthStore.getState()
      if (
        current.sessionVersion !== sessionVersion ||
        current.refreshToken !== refreshToken
      )
        return false
      useAuthStore.getState().setTokens(data.token, data.refresh_token)
      return true
    } catch (error) {
      if (error instanceof ConnectionError) throw error
      return false
    }
  })()
  const entry = { sessionVersion, refreshToken, promise }
  refreshInFlight = entry
  try {
    return await promise
  } finally {
    if (refreshInFlight === entry) refreshInFlight = null
  }
}

/** 旧请求的 401 不能刷新或登出新账号；已完成轮换则直接使用新令牌重试。 */
export async function refreshForRequest(
  sessionVersion: number,
  rejectedToken: string | null
): Promise<void> {
  assertSessionCurrent(sessionVersion)
  if (useAuthStore.getState().token !== rejectedToken) return
  const refreshed = await tryRefresh(sessionVersion)
  assertSessionCurrent(sessionVersion)
  if (!refreshed) {
    useAuthStore.getState().logout()
    throw new Error('登录已过期，请重新登录')
  }
}

/** 登出：尽力调用后端吊销令牌，失败不阻塞本地清理 */
export async function logoutRemote(): Promise<void> {
  const { token, refreshToken } = useAuthStore.getState()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    await apiFetch(apiUrl('go', '/auth/logout'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal
    })
  } catch {
    // 忽略网络错误，本地登出照常进行
  } finally {
    clearTimeout(timeout)
  }
}
