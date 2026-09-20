import { useAuthStore } from '../stores/auth'
import { assertSessionCurrent, refreshForRequest } from './authSession'
import { apiUrl } from './config'
import { isPreviewBuild, usePreviewStore } from '../lib/preview'
import { ConnectionError, httpStatusMessage } from '../lib/connection'
import { MAX_FOOD_IMAGE_BYTES } from '../lib/foodImage'
import { apiFetch } from './http'
import type {
  UserProfile,
  DietRecord,
  DailySummary,
  DietLogInput,
  Paginated
} from '../types'

function getUserId(): number {
  if (isPreviewBuild() && usePreviewStore.getState().active) return 0
  const user = useAuthStore.getState().user
  if (!user) throw new Error('未登录')
  return user.id
}

// Go 后端统一错误契约：{ code, message }
interface ApiErrorBody {
  code?: string
  message?: string
  error?: string
  detail?: string
}

interface AuthResponse {
  token: string
  refresh_token: string
  expires_in: number
  id: number
  username: string
}

// 401 后自动用 refresh_token 换新令牌并重试一次；失败则清除本地登录态
async function request<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
  authenticated = true
): Promise<T> {
  const { token, sessionVersion } = useAuthStore.getState()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>)
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (token && authenticated) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const resp = await apiFetch(apiUrl('go', path), { ...options, headers })
  if (authenticated) assertSessionCurrent(sessionVersion)

  if (resp.status === 401 && authenticated) {
    void resp.body?.cancel().catch(() => {})
    if (!retried) {
      await refreshForRequest(sessionVersion, token)
      assertSessionCurrent(sessionVersion)
      return request<T>(path, options, true)
    }
    useAuthStore.getState().logout()
    throw new Error('登录已过期，请重新登录')
  }

  // 507 是可操作的照片存储错误，保留服务端的安全提示；其他 5xx
  // 统一隐藏内部细节。
  if (resp.status >= 500 && resp.status !== 507) {
    void resp.body?.cancel().catch(() => {})
    throw new ConnectionError('service')
  }
  if (!resp.ok) {
    const err = (await resp
      .json()
      .catch(() => ({ message: httpStatusMessage(resp.status) }))) as ApiErrorBody
    throw new Error(
      err.message || err.error || err.detail || httpStatusMessage(resp.status)
    )
  }
  const data = await resp.json()
  if (authenticated) assertSessionCurrent(sessionVersion)
  return data
}

export const goApi = {
  register: (username: string, password: string) =>
    request<{ id: number; username: string }>(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ username, password })
      },
      false,
      false
    ),

  login: (username: string, password: string) =>
    request<AuthResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password })
      },
      false,
      false
    ),

  logout: () =>
    request<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({
        refresh_token: useAuthStore.getState().refreshToken
      })
    }),

  getProfile: () => request<UserProfile>(`/users/${getUserId()}/profile`),

  updateProfile: (data: UserProfile) =>
    request<UserProfile>(`/users/${getUserId()}/profile`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  uploadImage: (file: File) => {
    if (file.size > MAX_FOOD_IMAGE_BYTES)
      return Promise.reject(new Error('照片超过 10 MiB，请选择更小的图片后重试'))
    const fd = new FormData()
    fd.append('image', file)
    return request<{
      id: number
      filename: string
      mime_type: string
      size: number
    }>('/images/upload', { method: 'POST', body: fd })
  },

  deleteImage: (id: number) =>
    request<{ message: string }>(`/images/${id}`, { method: 'DELETE' }),

  createDietLog: (data: DietLogInput) =>
    request<DietRecord>('/diet/logs', {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  createDietBatch: (requestId: string, records: DietLogInput[]) =>
    request<DietRecord[]>('/diet/logs/batch', {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, records })
    }),

  getDietLogs: (date: string) =>
    request<DietRecord[]>(`/diet/logs?date=${date}`),

  updateDietLog: (id: number, data: DietLogInput) =>
    request<DietRecord>(`/diet/logs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

  deleteDietLog: (id: number) =>
    request<{ message: string }>(`/diet/logs/${id}`, { method: 'DELETE' }),

  getSummaries: (start: string, end: string, limit = 100, offset = 0) =>
    request<Paginated<DailySummary>>(
      `/diet/summaries?start=${start}&end=${end}&limit=${limit}&offset=${offset}`
    )
}
