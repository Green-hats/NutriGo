import { create } from 'zustand'
import { useChatStore } from '../stores/chat'

/** Only the separately built preview package can enter this read-only mode. */
export function isPreviewBuild() {
  return (
    import.meta.env.MODE === 'preview' &&
    import.meta.env.VITE_ENABLE_PREVIEW === 'true'
  )
}

export const previewUser = { id: 0, username: '界面体验 · 示例用户' }
export const usePreviewStore = create<{
  active: boolean
  enter: () => void
  exit: () => void
}>((set) => ({
  active: false,
  enter: () => {
    if (!isPreviewBuild()) return
    useChatStore.getState().clearMessages()
    set({ active: true })
  },
  exit: () => {
    useChatStore.getState().clearMessages()
    useChatStore.getState().setStreaming(false)
    set({ active: false })
  }
}))
