import { useEffect } from 'react'

/** 跟随手机可视区域变化，避免软键盘遮住聊天输入框。 */
export function useMobileViewport() {
  useEffect(() => {
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
      root.dataset.keyboardOpen = String(fullHeight - height > 150)
    }
    update()
    viewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      root.style.removeProperty('--app-height')
      delete root.dataset.keyboardOpen
    }
  }, [])
}
