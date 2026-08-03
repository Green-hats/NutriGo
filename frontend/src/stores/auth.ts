import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, UserProfile } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  profile: UserProfile | null
  setAuth: (token: string, user: User) => void
  setProfile: (profile: UserProfile) => void
  logout: () => void
  isLoggedIn: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      profile: null,
      setAuth: (token, user) => set({ token, user }),
      setProfile: (profile) => set({ profile }),
      logout: () => set({ token: null, user: null, profile: null }),
      isLoggedIn: () => !!get().token,
    }),
    { name: 'nutrigo-auth' }
  )
)
