import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectionNotice } from './ConnectionNotice'
import { usePreviewStore } from '../../lib/preview'

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/toast', () => ({ toast: toastMock }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  toastMock.mockClear()
  usePreviewStore.getState().exit()
})

it('断网显示持续提示，恢复后提示手动重试并移除断网提示', () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  render(<ConnectionNotice />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  act(() => {
    online.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
  })
  expect(screen.getByRole('alert')).toHaveTextContent('当前没有网络')
  expect(screen.getByRole('alert')).toHaveTextContent('不会自动重发')
  act(() => {
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
  })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(toastMock).toHaveBeenCalledWith(
    '网络已恢复，请重试刚才的操作。',
    'success'
  )
})

it('体验模式始终标注示例数据，退出不留下体验会话', async () => {
  vi.stubEnv('MODE', 'preview')
  vi.stubEnv('VITE_ENABLE_PREVIEW', 'true')
  usePreviewStore.getState().enter()
  render(<ConnectionNotice />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    '示例数据，不会上传或保存'
  )
  await userEvent.click(screen.getByRole('button', { name: '退出体验' }))
  expect(usePreviewStore.getState().active).toBe(false)
  expect(screen.getByRole('alert')).toHaveTextContent('尚未连接云端')
})
