import { isTauri } from '@tauri-apps/api/core'

/** App 使用原生 HTTP（支持 multipart / SSE），浏览器预览使用同源 fetch。 */
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  if (!isTauri()) return globalThis.fetch(url, options)
  const absolute = new URL(url, window.location.origin).href
  return import('@tauri-apps/plugin-http').then(({ fetch }) => fetch(absolute, options))
}
