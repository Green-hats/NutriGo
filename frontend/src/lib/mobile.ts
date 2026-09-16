import { useLayoutEffect } from 'react'

declare global {
  interface Window {
    NutriGoInsets?: { getInsets(): string }
  }
}

interface AndroidInsets {
  top: number
  right: number
  bottom: number
  left: number
  keyboardOpen: boolean
}

const edges = ['top', 'right', 'bottom', 'left'] as const

function readAndroidInsets(): AndroidInsets | undefined {
  try {
    if (!window.NutriGoInsets) return
    const value = JSON.parse(window.NutriGoInsets.getInsets())
    if (
      value &&
      edges.every((edge) => Number.isFinite(value[edge]) && value[edge] >= 0) &&
      typeof value.keyboardOpen === 'boolean'
    ) return value
  } catch {
    // Browser and iOS continue to use their own CSS safe-area insets.
  }
}

/** 跟随手机可视区域变化，避免软键盘遮住聊天输入框。 */
export function useMobileViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let width = window.innerWidth
    let fullHeight = window.innerHeight
    const update = () => {
      const height = viewport?.height ?? window.innerHeight
      if (width !== window.innerWidth) {
        width = window.innerWidth
        fullHeight = window.innerHeight
      }
      fullHeight = Math.max(fullHeight, height)
      root.style.setProperty('--app-height', `${height}px`)
      const insets = readAndroidInsets()
      if (insets) {
        // Android returns physical pixels. Convert once; do not also add CSS env() insets.
        const scale = window.devicePixelRatio || 1
        for (const edge of edges) {
          root.style.setProperty(`--safe-area-${edge}`, `${insets[edge] / scale}px`)
        }
        root.dataset.nativePlatform = 'android'
      }
      root.dataset.keyboardOpen = String(insets?.keyboardOpen ?? (fullHeight - height > 150))
    }
    update()
    viewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    window.addEventListener('nutrigo:insets', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('nutrigo:insets', update)
      root.style.removeProperty('--app-height')
      for (const edge of edges) root.style.removeProperty(`--safe-area-${edge}`)
      delete root.dataset.nativePlatform
      delete root.dataset.keyboardOpen
    }
  }, [])
}
