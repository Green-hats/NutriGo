const AGENT_URL = '/agent-api'

async function post<T>(path: string, body: any): Promise<T> {
  const resp = await fetch(`${AGENT_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || `HTTP ${resp.status}`)
  }
  return resp.json()
}

async function del(path: string): Promise<void> {
  await fetch(`${AGENT_URL}${path}`, { method: 'DELETE' })
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${AGENT_URL}${path}`)
  return resp.json()
}

export const agentApi = {
  identifyFood: (imageId: number) =>
    post<any[]>('/identify-food', { image_id: imageId }),

  calculateIntake: (foodName: string, grams: number) =>
    post<any>('/calculate-intake', { food_name: foodName, grams }),

  getSessions: () => get<any[]>('/sessions'),

  getSession: (id: number) => get<any>(`/sessions/${id}`),

  deleteSession: (id: number) => del(`/sessions/${id}`),
}
