import { useAuthStore } from '../stores/auth'
import { assertSessionCurrent, refreshForRequest } from './authSession'
import { apiUrl } from './config'
import { ConnectionError } from '../lib/connection'
import { apiFetch } from './http'
import type {
  IdentifyResult,
  MealAnalysis,
  IntakeResult,
  SessionInfo,
  SessionDetail,
  Paginated
} from '../types'

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// 401 后自动用 refresh_token 换新令牌并重试一次；失败则清除本地登录态
async function request<T>(
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<T> {
  const { token, sessionVersion } = useAuthStore.getState()
  const resp = await apiFetch(apiUrl('agent', path), {
    ...init,
    timeoutMs: 60_000,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers as Record<string, string>)
    }
  })
  assertSessionCurrent(sessionVersion)

  if (resp.status === 401) {
    void resp.body?.cancel().catch(() => {})
    if (!retried) {
      await refreshForRequest(sessionVersion, token)
      assertSessionCurrent(sessionVersion)
      return request<T>(path, init, true)
    }
    useAuthStore.getState().logout()
    throw new Error('登录已过期，请重新登录')
  }

  if (resp.status >= 500) {
    void resp.body?.cancel().catch(() => {})
    throw new ConnectionError('service')
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || err.message || `HTTP ${resp.status}`)
  }
  const data = await resp.json()
  assertSessionCurrent(sessionVersion)
  return data
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

async function del(path: string): Promise<void> {
  await request<{ message: string }>(path, { method: 'DELETE' })
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

export const agentApi = {
  analyzeMeal: (imageId: number, signal?: AbortSignal) =>
    request<MealAnalysis>('/analyze-meal', {
      method: 'POST', body: JSON.stringify({ image_id: imageId }), signal
    }),

  identifyFood: (imageId: number) =>
    post<IdentifyResult[]>('/identify-food', { image_id: imageId }),

  calculateIntake: (foodName: string, grams: number) =>
    post<IntakeResult>('/calculate-intake', { food_name: foodName, grams }),

  getSessions: (limit = 20, offset = 0) =>
    get<Paginated<SessionInfo>>(`/sessions?limit=${limit}&offset=${offset}`),

  getSession: (id: number) => get<SessionDetail>(`/sessions/${id}`),

  deleteSession: (id: number) => del(`/sessions/${id}`),

  batchDeleteSessions: (ids: number[]) =>
    post<{ deleted: number }>('/sessions/batch-delete', { ids }),

  renameSession: (id: number, name: string) =>
    patch<{ message: string }>(`/sessions/${id}`, { name }),

  regenerateSession: (id: number) =>
    post<{ message: string }>(`/sessions/${id}/regenerate`, {})
}
