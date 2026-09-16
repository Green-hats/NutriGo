import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiUrl } from './config'

afterEach(() => vi.unstubAllEnvs())

describe('App 云端地址', () => {
  it('开发时沿用本地同源代理', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(apiUrl('go', '/auth/login')).toBe('/api/auth/login')
    expect(apiUrl('agent', '/sessions')).toBe('/agent-api/sessions')
  })
  it('两个服务共用一个 HTTPS 入口并保留查询参数', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/')
    expect(apiUrl('go', '/auth/refresh')).toBe('https://api.example.com/api/auth/refresh')
    expect(apiUrl('agent', '/chat?message=a%2Bb')).toBe('https://api.example.com/agent-api/chat?message=a%2Bb')
  })
  it.each(['https://user:secret@api.example.com', 'https://api.example.com/api', 'https://api.example.com/?key=secret'])
    ('拒绝非根地址 %s', (url) => {
      vi.stubEnv('VITE_API_BASE_URL', url)
      expect(() => apiUrl('go', '/health')).toThrow()
    })
  it('生产拒绝明文 HTTP', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.example.com')
    expect(() => apiUrl('go', '/health')).toThrow('HTTPS')
  })
})
