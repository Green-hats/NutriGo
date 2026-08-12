import { useAuthStore } from '../stores/auth'

// 并发刷新护栏：同一时刻只允许一个 refresh 请求在途，
// 其余并发 401 请求共享同一个 Promise。
let refreshPromise: Promise<boolean> | null = null

/**
 * 用 refresh_token 换取新令牌对并写入 store。
 * 成功返回 true；无 refresh_token 或刷新失败返回 false（调用方应登出）。
 */
export async function tryRefresh(): Promise<boolean> {
  const { refreshToken, token } = useAuthStore.getState()
  if (!refreshToken || !token) return false

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const resp = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (!resp.ok) return false
        const data = await resp.json()
        useAuthStore.getState().setTokens(data.token, data.refresh_token)
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

/** 登出：尽力调用后端吊销令牌，失败不阻塞本地清理 */
export async function logoutRemote(): Promise<void> {
  const { token, refreshToken } = useAuthStore.getState()
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
  } catch {
    // 忽略网络错误，本地登出照常进行
  }
}
