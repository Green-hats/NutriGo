import { isTauri } from '@tauri-apps/api/core'
import { ConnectionError, isOffline } from '../lib/connection'
import { isPreviewBuild } from '../lib/preview'

export type ApiRequestOptions = RequestInit & { timeoutMs?: number }

/** Bound both the connection and each body read; SSE chunks reset the idle deadline. */
export async function apiFetch(
  url: string,
  options: ApiRequestOptions = {}
): Promise<Response> {
  if (isPreviewBuild()) {
    const { previewResponse } = await import('./preview')
    return previewResponse(url, options)
  }
  if (isOffline()) throw new ConnectionError('offline')
  const { timeoutMs = 20_000, signal: callerSignal, ...init } = options
  const controller = new AbortController()
  let timeout = false
  const forwardAbort = () => controller.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', forwardAbort, { once: true })
  if (callerSignal?.aborted) forwardAbort()
  const cleanup = () => callerSignal?.removeEventListener('abort', forwardAbort)
  const normalize = (error: unknown) => {
    if (callerSignal?.aborted)
      return new DOMException('Request cancelled', 'AbortError')
    if (timeout) return new ConnectionError('timeout')
    if (error instanceof ConnectionError) return error
    return new ConnectionError(isOffline() ? 'offline' : 'unreachable')
  }
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
      if (controller.signal.aborted) rejectAbort()
    })
    const timer = setTimeout(() => {
      timeout = true
      controller.abort(new ConnectionError('timeout'))
    }, timeoutMs)
    try {
      return await Promise.race([promise, aborted])
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', rejectAbort)
    }
  }
  try {
    const response = await bounded(
      (async () => {
        const request = { ...init, signal: controller.signal }
        if (!isTauri()) return globalThis.fetch(url, request)
        const { fetch } = await import('@tauri-apps/plugin-http')
        return fetch(new URL(url, window.location.origin).href, request)
      })()
    )
    if (!response.body) {
      cleanup()
      return response
    }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const result = await bounded(reader.read())
          if (result.done) {
            cleanup()
            reader.releaseLock()
            stream.close()
          } else stream.enqueue(result.value)
        } catch (error) {
          cleanup()
          controller.abort()
          void reader.cancel().catch(() => {})
          stream.error(normalize(error))
        }
      },
      cancel(reason) {
        cleanup()
        controller.abort(reason)
        return reader.cancel(reason)
      }
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  } catch (error) {
    cleanup()
    throw normalize(error)
  }
}
