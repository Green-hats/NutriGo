import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useChatStore } from './chat'
import type { User, UserProfile } from '../types'

interface AuthState {
  sessionVersion: number
  token: string | null
  refreshToken: string | null
  user: User | null
  profile: UserProfile | null
  setAuth: (token: string, user: User, refreshToken?: string | null) => void
  setTokens: (token: string, refreshToken: string) => void
  setProfile: (profile: UserProfile) => void
  logout: () => void
  isLoggedIn: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      sessionVersion: 0,
      token: null,
      refreshToken: null,
      user: null,
      profile: null,
      setAuth: (token, user, refreshToken = null) => {
        useChatStore.getState().clearMessages()
        useChatStore.getState().setStreaming(false)
        set({ token, user, refreshToken, profile: null, sessionVersion: get().sessionVersion + 1 })
      },
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      setProfile: (profile) => set({ profile }),
      logout: () => {
        useChatStore.getState().clearMessages()
        useChatStore.getState().setStreaming(false)
        set({ token: null, user: null, profile: null, refreshToken: null, sessionVersion: get().sessionVersion + 1 })
      },
      isLoggedIn: () => !!get().token,
    }),
    {
      name: `nutrigo-auth:${import.meta.env.VITE_API_BASE_URL || 'development'}`,
      partialize: ({ token, refreshToken, user }) => ({ token, refreshToken, user }),
    }
  )
)
