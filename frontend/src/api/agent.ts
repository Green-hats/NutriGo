const AGENT_URL = '/agent-api'

import { useAuthStore } from '../stores/auth'
import { tryRefresh } from './authSession'
import type {
  IdentifyResult, IntakeResult, SessionInfo, SessionDetail,
} from '../types'

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

// 401 后自动用 refresh_token 换新令牌并重试一次；失败则清除本地登录态
async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const resp = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers as Record<string, string>) },
  })

  if (resp.status === 401 && !retried) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      return request<T>(path, init, true)
    }
    useAuthStore.getState().logout()
    throw new Error('登录已过期，请重新登录')
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
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
  identifyFood: (imageId: number) =>
    post<IdentifyResult[]>('/identify-food', { image_id: imageId }),

  calculateIntake: (foodName: string, grams: number) =>
    post<IntakeResult>('/calculate-intake', { food_name: foodName, grams }),

  getSessions: () => get<SessionInfo[]>('/sessions'),

  getSession: (id: number) => get<SessionDetail>(`/sessions/${id}`),

  deleteSession: (id: number) => del(`/sessions/${id}`),

  renameSession: (id: number, name: string) =>
    patch<{ message: string }>(`/sessions/${id}`, { name }),

  regenerateSession: (id: number) =>
    post<{ message: string }>(`/sessions/${id}/regenerate`, {}),
}
