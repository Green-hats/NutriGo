import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistorySidebar from './HistorySidebar'

const getSessionsMock = vi.fn()
const batchDeleteSessionsMock = vi.fn()
vi.mock('../../api/agent', () => ({
  agentApi: {
    getSessions: (...args: unknown[]) => getSessionsMock(...args),
    batchDeleteSessions: (...args: unknown[]) => batchDeleteSessionsMock(...args),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
  },
}))

const toastMock = vi.fn()
vi.mock('../../lib/toast', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))

const sessions = {
  items: [
    { id: 1, name: '会话一', created_at: '2026-08-13 10:00:00' },
    { id: 2, name: '会话二', created_at: '2026-08-12 09:00:00' },
    { id: 3, name: '会话三', created_at: '2026-08-11 08:00:00' },
  ],
  total: 3, limit: 20, offset: 0,
}

beforeEach(() => {
  getSessionsMock.mockReset()
  batchDeleteSessionsMock.mockReset()
  toastMock.mockClear()
  getSessionsMock.mockResolvedValue(sessions)
})

describe('HistorySidebar 批量删除', () => {
  it('渲染会话列表', async () => {
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())
    expect(screen.getByText('会话二')).toBeInTheDocument()
  })

  it('管理模式下勾选多个会话并批量删除', async () => {
    batchDeleteSessionsMock.mockResolvedValue({ deleted: 2 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())

    // 进入管理模式
    await user.click(screen.getByRole('button', { name: '批量管理会话' }))
    expect(screen.getByText(/已选 0 项/)).toBeInTheDocument()

    // 勾选 1、2 两个会话
    await user.click(screen.getByRole('checkbox', { name: /选择会话 会话一/ }))
    await user.click(screen.getByRole('checkbox', { name: /选择会话 会话二/ }))
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument()

    // 删除所选
    await user.click(screen.getByRole('button', { name: '删除所选会话' }))
    expect(batchDeleteSessionsMock).toHaveBeenCalledWith([1, 2])
    await waitFor(() => expect(screen.queryByText('会话一')).not.toBeInTheDocument())
    expect(screen.queryByText('会话二')).not.toBeInTheDocument()
    expect(screen.getByText('会话三')).toBeInTheDocument()
    expect(toastMock).toHaveBeenCalledWith('已删除 2 个会话', 'success')
  })

  it('未勾选时删除按钮禁用', async () => {
    const user = userEvent.setup()
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '批量管理会话' }))
    expect(screen.getByRole('button', { name: '删除所选会话' })).toBeDisabled()
  })

  it('取消确认则不删除', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '批量管理会话' }))
    await user.click(screen.getByRole('checkbox', { name: /选择会话 会话一/ }))
    await user.click(screen.getByRole('button', { name: '删除所选会话' }))

    expect(batchDeleteSessionsMock).not.toHaveBeenCalled()
    expect(screen.getByText('会话一')).toBeInTheDocument()
  })
})
