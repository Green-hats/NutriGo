const AGENT_URL = '/agent-api'

import { useAuthStore } from '../stores/auth'
import type {
  IdentifyResult, IntakeResult, SessionInfo, SessionDetail,
} from '../types'

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${AGENT_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
}

async function del(path: string): Promise<void> {
  const resp = await fetch(`${AGENT_URL}${path}`, { method: 'DELETE', headers: authHeaders() })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${AGENT_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${AGENT_URL}${path}`, { headers: authHeaders() })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
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
