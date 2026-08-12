import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, UserProfile } from '../types'

interface AuthState {
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
      token: null,
      refreshToken: null,
      user: null,
      profile: null,
      setAuth: (token, user, refreshToken = null) => set({ token, user, refreshToken }),
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      setProfile: (profile) => set({ profile }),
      logout: () => set({ token: null, user: null, profile: null, refreshToken: null }),
      isLoggedIn: () => !!get().token,
    }),
    { name: 'nutrigo-auth' }
  )
)
