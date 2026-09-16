import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMobileViewport } from './mobile'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function androidInsets(initial = { top: 156, right: 0, bottom: 72, left: 0, keyboardOpen: false }) {
  const getInsets = vi.fn(() => JSON.stringify(initial))
  vi.stubGlobal('NutriGoInsets', { getInsets })
  vi.stubGlobal('devicePixelRatio', 3)
  return getInsets
}

it('Android 安全区按设备像素比换算，页面高度保留整个 WebView 区域', () => {
  androidInsets()
  vi.stubGlobal('innerHeight', 952)
  renderHook(useMobileViewport)
  const root = document.documentElement
  expect(root.style.getPropertyValue('--app-height')).toBe('952px')
  expect(root.style.getPropertyValue('--safe-area-top')).toBe('52px')
  expect(root.style.getPropertyValue('--safe-area-bottom')).toBe('24px')
  expect(root.dataset.nativePlatform).toBe('android')
})

it('Android 键盘出现与关闭明确切换导航状态，并恢复底部安全区', () => {
  const getInsets = androidInsets()
  renderHook(useMobileViewport)
  act(() => {
    getInsets.mockReturnValue(JSON.stringify({ top: 156, right: 0, bottom: 0, left: 0, keyboardOpen: true }))
    window.dispatchEvent(new Event('nutrigo:insets'))
  })
  expect(document.documentElement.dataset.keyboardOpen).toBe('true')
  expect(document.documentElement.style.getPropertyValue('--safe-area-bottom')).toBe('0px')
  act(() => {
    getInsets.mockReturnValue(JSON.stringify({ top: 156, right: 0, bottom: 72, left: 0, keyboardOpen: false }))
    window.dispatchEvent(new Event('nutrigo:insets'))
  })
  expect(document.documentElement.dataset.keyboardOpen).toBe('false')
  expect(document.documentElement.style.getPropertyValue('--safe-area-bottom')).toBe('24px')
})

it('旋转屏幕或缩小窗口时更新刘海位置，不误判为键盘弹出', () => {
  const getInsets = androidInsets()
  vi.stubGlobal('innerHeight', 952)
  renderHook(useMobileViewport)
  act(() => {
    vi.stubGlobal('innerHeight', 426)
    getInsets.mockReturnValue(JSON.stringify({ top: 72, right: 0, bottom: 72, left: 156, keyboardOpen: false }))
    window.dispatchEvent(new Event('resize'))
  })
  expect(document.documentElement.dataset.keyboardOpen).toBe('false')
  expect(document.documentElement.style.getPropertyValue('--safe-area-left')).toBe('52px')
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('426px')
})

it('浏览器和 iOS 保留 CSS 安全区，使用可视区域避开键盘', () => {
  const viewport = Object.assign(new EventTarget(), { height: 844 })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('innerHeight', 844)
  renderHook(useMobileViewport)
  expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('')
  expect(document.documentElement.dataset.nativePlatform).toBeUndefined()
  act(() => {
    viewport.height = 460
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('460px')
  expect(document.documentElement.dataset.keyboardOpen).toBe('true')
})

it.each(['invalid JSON', '{"top":-1}', 'null'])('忽略无效的原生尺寸 %s', (value) => {
  const getInsets = androidInsets()
  getInsets.mockReturnValue(value)
  renderHook(useMobileViewport)
  expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('')
  expect(document.documentElement.dataset.nativePlatform).toBeUndefined()
})

it('卸载后清理样式及原生事件监听，避免残留安全区', () => {
  const getInsets = androidInsets()
  const { unmount } = renderHook(useMobileViewport)
  unmount()
  getInsets.mockClear()
  window.dispatchEvent(new Event('nutrigo:insets'))
  expect(getInsets).not.toHaveBeenCalled()
  expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('')
  expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('')
  expect(document.documentElement.dataset.nativePlatform).toBeUndefined()
})
