import { useAuthStore } from '../stores/auth'

const GO_URL = '/api'

function getUserId(): number {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('未登录')
  return user.id
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
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
    request<{ token: string; id: number; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getProfile: () =>
    request<any>(`/users/${getUserId()}/profile`),

  updateProfile: (data: any) =>
    request<any>(`/users/${getUserId()}/profile`, {
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

  createDietLog: (data: any) =>
    request<any>('/diet/logs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getDietLogs: (date: string) =>
    request<any[]>(`/diet/logs?date=${date}`),

  deleteDietLog: (id: number) =>
    request<{ message: string }>(`/diet/logs/${id}`, { method: 'DELETE' }),

  getSummaries: (start: string, end: string) =>
    request<any[]>(`/diet/summaries?start=${start}&end=${end}`),
}
