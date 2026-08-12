import { useAuthStore } from '../stores/auth'
import { tryRefresh } from './authSession'
import type { UserProfile, DietRecord, DailySummary, DietLogInput } from '../types'

const GO_URL = '/api'

function getUserId(): number {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('未登录')
  return user.id
}

interface ApiErrorBody {
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
async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const resp = await fetch(`${GO_URL}${path}`, { ...options, headers })

  if (resp.status === 401 && !retried) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      return request<T>(path, options, true)
    }
    useAuthStore.getState().logout()
    throw new Error('登录已过期，请重新登录')
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText })) as ApiErrorBody
    throw new Error(err.error || err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
}

export const goApi = {
  register: (username: string, password: string) =>
    request<{ id: number; username: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: useAuthStore.getState().refreshToken }),
    }),

  getProfile: () =>
    request<UserProfile>(`/users/${getUserId()}/profile`),

  updateProfile: (data: UserProfile) =>
    request<UserProfile>(`/users/${getUserId()}/profile`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  uploadImage: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return request<{ id: number; filename: string; mime_type: string; size: number }>(
      '/images/upload',
      { method: 'POST', body: fd }
    )
  },

  deleteImage: (id: number) =>
    request<{ message: string }>(`/images/${id}`, { method: 'DELETE' }),

  createDietLog: (data: DietLogInput) =>
    request<DietRecord>('/diet/logs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getDietLogs: (date: string) =>
    request<DietRecord[]>(`/diet/logs?date=${date}`),

  deleteDietLog: (id: number) =>
    request<{ message: string }>(`/diet/logs/${id}`, { method: 'DELETE' }),

  getSummaries: (start: string, end: string) =>
    request<DailySummary[]>(`/diet/summaries?start=${start}&end=${end}`),
}
