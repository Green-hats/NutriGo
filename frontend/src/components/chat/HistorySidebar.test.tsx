import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistorySidebar from './HistorySidebar'

const getSessionsMock = vi.fn()
const batchDeleteSessionsMock = vi.fn()
const deleteSessionMock = vi.fn()
vi.mock('../../api/agent', () => ({
  agentApi: {
    getSessions: (...args: unknown[]) => getSessionsMock(...args),
    batchDeleteSessions: (...args: unknown[]) =>
      batchDeleteSessionsMock(...args),
    getSession: vi.fn(),
    deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
    renameSession: vi.fn()
  }
}))

const toastMock = vi.fn()
vi.mock('../../lib/toast', () => ({
  toast: (...a: unknown[]) => toastMock(...a)
}))

const sessions = {
  items: [
    { id: 1, name: '会话一', created_at: '2026-08-13 10:00:00' },
    { id: 2, name: '会话二', created_at: '2026-08-12 09:00:00' },
    { id: 3, name: '会话三', created_at: '2026-08-11 08:00:00' }
  ],
  total: 3,
  limit: 20,
  offset: 0
}

beforeEach(() => {
  getSessionsMock.mockReset()
  batchDeleteSessionsMock.mockReset()
  deleteSessionMock.mockReset()
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
    expect(batchDeleteSessionsMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    expect(batchDeleteSessionsMock).toHaveBeenCalledWith([1, 2])
    await waitFor(() =>
      expect(screen.queryByText('会话一')).not.toBeInTheDocument()
    )
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
    const user = userEvent.setup()
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '批量管理会话' }))
    await user.click(screen.getByRole('checkbox', { name: /选择会话 会话一/ }))
    await user.click(screen.getByRole('button', { name: '删除所选会话' }))

    await user.click(screen.getByRole('button', { name: '保留会话' }))
    expect(batchDeleteSessionsMock).not.toHaveBeenCalled()
    expect(screen.getByText('会话一')).toBeInTheDocument()
  })
})

describe('HistorySidebar 确认弹窗和重试', () => {
  it('单项删除失败后保留会话和确认弹窗，允许重试', async () => {
    deleteSessionMock
      .mockRejectedValueOnce(new Error('网络暂时不可用'))
      .mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await screen.findByText('会话一')
    await user.click(screen.getAllByRole('button', { name: '删除会话' })[0])
    expect(deleteSessionMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('网络暂时不可用')
    )
    expect(screen.getByText('会话一')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(screen.queryByText('会话一')).not.toBeInTheDocument()
    )
    expect(deleteSessionMock).toHaveBeenNthCalledWith(2, 1)
  })

  it('会话列表加载失败可以重新加载', async () => {
    getSessionsMock.mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render(<HistorySidebar onSelect={() => {}} onClose={() => {}} />)
    await screen.findByText('历史会话加载失败')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('会话一')).toBeInTheDocument()
  })
})
