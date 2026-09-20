export type ConnectionFailure =
  'offline' | 'timeout' | 'unreachable' | 'service' | 'unconfigured'

const messages: Record<ConnectionFailure, string> = {
  offline: '当前没有网络，请连接 Wi-Fi 或移动网络后重试。',
  timeout: '连接超时，请检查网络后重试。',
  unreachable: '暂时无法连接服务器，请检查网络或稍后重试。',
  service: '服务暂时不可用，请稍后重试。',
  unconfigured: '此体验包尚未连接云端，请使用离线界面体验。'
}

export class ConnectionError extends Error {
  readonly kind: ConnectionFailure
  constructor(kind: ConnectionFailure) {
    super(messages[kind])
    this.name = 'ConnectionError'
    this.kind = kind
  }
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function httpStatusMessage(status: number): string {
  switch (status) {
    case 408:
      return '请求超时，请稍后重试。'
    case 413:
      return '请求内容过大，请缩小后重试。'
    case 415:
      return '文件格式不受支持，请更换后重试。'
    case 429:
      return '操作过于频繁，请稍后重试。'
    case 504:
      return '处理超时，请稍后重试。'
    case 507:
      return '服务器存储空间不足，请稍后重试。'
    default:
      return `请求失败（HTTP ${status}）`
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConnectionError) return error.message
  const message = error instanceof Error ? error.message : ''
  if (
    /failed to fetch|fetch failed|networkerror|load failed|error sending request|network request failed/i.test(
      message
    )
  ) {
    return messages[isOffline() ? 'offline' : 'unreachable']
  }
  return message || fallback
}
