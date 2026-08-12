import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Diary from './Diary'
import { useAuthStore } from '../stores/auth'
import type { DietRecord } from '../types'

const getDietLogsMock = vi.fn()
const deleteDietLogMock = vi.fn()
vi.mock('../api/go', () => ({
  goApi: {
    getDietLogs: (...args: unknown[]) => getDietLogsMock(...args),
    deleteDietLog: (...args: unknown[]) => deleteDietLogMock(...args),
  },
}))

const toastMock = vi.fn()
vi.mock('../components/ui/Toast', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))

vi.mock('../components/diary/NutritionChart', () => ({ default: () => <div data-testid="chart" /> }))

const record: DietRecord = {
  id: 1, user_id: 1, date: '2026-08-12', meal_type: 'lunch', food_name: '宫保鸡丁', portion: '1份',
  calories: 450, protein_g: 30, fat_g: 22, carbs_g: 35, created_at: '2026-08-12T10:00:00Z',
}

beforeEach(() => {
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  getDietLogsMock.mockReset()
  deleteDietLogMock.mockReset()
  toastMock.mockClear()
})

describe('Diary 日记页', () => {
  it('加载并展示当天的饮食记录与摄入合计', async () => {
    getDietLogsMock.mockResolvedValue([record])
    render(<Diary />)

    await waitFor(() => expect(getDietLogsMock).toHaveBeenCalled())
    expect(screen.getByText('宫保鸡丁')).toBeInTheDocument()
    // 今日摄入合计与记录行都含 450 kcal
    expect(screen.getAllByText(/450/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('今日摄入')).toBeInTheDocument()
  })

  it('无记录时显示空状态与拍照按钮', async () => {
    getDietLogsMock.mockResolvedValue([])
    render(<Diary />)

    await waitFor(() => expect(screen.getByText(/今天还没有记录/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /拍照记录/ })).toBeInTheDocument()
  })

  it('删除记录调用 deleteDietLog 并重新拉取', async () => {
    getDietLogsMock.mockResolvedValue([record])
    deleteDietLogMock.mockResolvedValue({})
    const user = userEvent.setup()
    render(<Diary />)

    await waitFor(() => expect(screen.getByText('宫保鸡丁')).toBeInTheDocument())
    const recordCard = screen.getByText('宫保鸡丁').closest('div.rounded-2xl') as HTMLElement
    await user.click(within(recordCard).getByRole('button'))

    await waitFor(() => expect(deleteDietLogMock).toHaveBeenCalledWith(1))
    // 删除后触发重新加载
    await waitFor(() => expect(getDietLogsMock).toHaveBeenCalledTimes(2))
  })

  it('点击图表按钮打开趋势图', async () => {
    getDietLogsMock.mockResolvedValue([])
    const user = userEvent.setup()
    render(<Diary />)

    // 页头第一个按钮为图表入口（当前为无名称的图标按钮）
    const chartButton = document.querySelector('.bg-green-600 button') as HTMLElement
    await user.click(chartButton)
    await waitFor(() => expect(screen.getByTestId('chart')).toBeInTheDocument())
  })
})
