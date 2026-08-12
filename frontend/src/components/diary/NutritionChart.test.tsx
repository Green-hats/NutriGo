import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NutritionChart from './NutritionChart'

const getSummariesMock = vi.fn()
vi.mock('../../api/go', () => ({
  goApi: { getSummaries: (...args: unknown[]) => getSummariesMock(...args) },
}))

// recharts 的 ResponsiveContainer 在 jsdom 中无尺寸，替换为简单 div，并捕获图表数据
const chartMocks = vi.hoisted(() => ({ data: [] as Array<{ date: string }> }))
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    BarChart: ({ data }: { data: Array<{ date: string }> }) => {
      chartMocks.data = data
      return <div />
    },
    Bar: Box, XAxis: Box, YAxis: Box, Tooltip: Box, ResponsiveContainer: Box, Legend: Box,
  }
})

beforeEach(() => {
  getSummariesMock.mockReset()
  chartMocks.data = []
})

describe('NutritionChart 营养趋势图', () => {
  it('加载后渲染趋势数据（非空状态）', async () => {
    getSummariesMock.mockResolvedValue({
      items: [
        { date: '2026-08-10', total_calories: 1800, total_protein_g: 70, total_fat_g: 50, total_carbs_g: 200 },
        { date: '2026-08-11', total_calories: 1900, total_protein_g: 80, total_fat_g: 45, total_carbs_g: 210 },
      ],
      total: 2, limit: 30, offset: 0,
    })
    render(<NutritionChart onClose={() => {}} />)

    expect(screen.getByText('营养趋势')).toBeInTheDocument()
    await waitFor(() => expect(getSummariesMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(/暂无数据/)).not.toBeInTheDocument())
    // 数据已传入图表：2 天记录（组件内 reverse 后为新→旧）
    expect(chartMocks.data).toHaveLength(2)
    expect(chartMocks.data.map((d) => d.date)).toEqual(['08-11', '08-10'])
  })

  it('无数据显示空状态提示', async () => {
    getSummariesMock.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 })
    render(<NutritionChart onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText(/暂无数据/)).toBeInTheDocument())
  })

  it('切换范围重新拉取数据', async () => {
    getSummariesMock.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 })
    const user = userEvent.setup()
    render(<NutritionChart onClose={() => {}} />)

    await waitFor(() => expect(getSummariesMock).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '14天' }))
    await waitFor(() => expect(getSummariesMock).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '30天' }))
    await waitFor(() => expect(getSummariesMock).toHaveBeenCalledTimes(3))
  })

  it('点击关闭按钮调用 onClose', async () => {
    getSummariesMock.mockResolvedValue({ items: [], total: 0, limit: 30, offset: 0 })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<NutritionChart onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '✕' }))
    expect(onClose).toHaveBeenCalled()
  })
})
