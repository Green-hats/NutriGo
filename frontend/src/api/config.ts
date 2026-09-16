type Service = 'go' | 'agent'

/** 一个云端 HTTPS 入口：Go /api，Agent /agent-api。开发预览使用 Vite 同源代理。 */
export function apiUrl(service: Service, path: string): string {
  const configured = (import.meta.env.VITE_API_BASE_URL ?? '').trim()
  let origin = ''
  if (configured) {
    const url = new URL(configured)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('API 地址只能包含协议、域名和端口')
    }
    if (url.protocol !== 'https:' && !(import.meta.env.DEV && url.protocol === 'http:')) {
      throw new Error('云端 API 必须使用 HTTPS')
    }
    origin = url.origin
  }
  const prefix = service === 'go' ? '/api' : '/agent-api'
  return `${origin}${prefix}${path}`
}
