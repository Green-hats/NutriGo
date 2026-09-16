import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './auth'
import { useChatStore } from './chat'

describe('mobile account isolation', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
    localStorage.clear()
  })

  it('clears the previous account conversation and profile on login', () => {
    useAuthStore.getState().setAuth('old', { id: 1, username: 'first' })
    useChatStore.getState().addMessage({ role: 'user', content: 'private meal' })
    useChatStore.getState().setSessionId(12)
    useAuthStore.getState().setProfile({ height_cm: 170, weight_kg: 65, age: 25, gender: 'male', goal: 'maintain', allergies: ['peanut'], dietary_habits: [], chronic_diseases: [] })

    useAuthStore.getState().setAuth('new', { id: 2, username: 'second' }, 'refresh')

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().sessionId).toBeNull()
    expect(useAuthStore.getState().profile).toBeNull()
    expect(useAuthStore.getState().user?.id).toBe(2)
  })

  it('persists the session without persisting the health profile', () => {
    useAuthStore.getState().setAuth('access', { id: 1, username: 'first' }, 'refresh')
    useAuthStore.getState().setProfile({ height_cm: 170, weight_kg: 65, age: 25, gender: 'male', goal: 'maintain', allergies: ['peanut'], dietary_habits: [], chronic_diseases: [] })

    const key = useAuthStore.persist.getOptions().name!
    const saved = JSON.parse(localStorage.getItem(key)!).state
    expect(saved).toEqual({ token: 'access', refreshToken: 'refresh', user: { id: 1, username: 'first' } })
  })

  it('clears local conversation and streaming state on logout', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'private response' })
    useChatStore.getState().setStreaming(true)
    useAuthStore.getState().logout()
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useAuthStore.getState().token).toBeNull()
  })
})
