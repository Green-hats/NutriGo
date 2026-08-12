import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Diary from './Diary'
import { useAuthStore } from '../stores/auth'
import type { DietRecord, IdentifyResult, IntakeResult } from '../types'

const getDietLogsMock = vi.fn()
const deleteDietLogMock = vi.fn()
const uploadImageMock = vi.fn()
const createDietLogMock = vi.fn()
vi.mock('../api/go', () => ({
  goApi: {
    getDietLogs: (...args: unknown[]) => getDietLogsMock(...args),
    deleteDietLog: (...args: unknown[]) => deleteDietLogMock(...args),
    uploadImage: (...args: unknown[]) => uploadImageMock(...args),
    createDietLog: (...args: unknown[]) => createDietLogMock(...args),
  },
}))

const identifyFoodMock = vi.fn()
const calculateIntakeMock = vi.fn()
vi.mock('../api/agent', () => ({
  agentApi: {
    identifyFood: (...args: unknown[]) => identifyFoodMock(...args),
    calculateIntake: (...args: unknown[]) => calculateIntakeMock(...args),
  },
}))

const toastMock = vi.fn()
vi.mock('../lib/toast', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))

vi.mock('../components/diary/NutritionChart', () => ({ default: () => <div data-testid="chart" /> }))

const record: DietRecord = {
  id: 1, user_id: 1, date: '2026-08-12', meal_type: 'lunch', food_name: '宫保鸡丁', portion: '1份',
  calories: 450, protein_g: 30, fat_g: 22, carbs_g: 35, created_at: '2026-08-12T10:00:00Z',
}

const candidate: IdentifyResult = {
  name: '宫保鸡丁', confidence: 0.9,
  nutrition_per_100g: { calories: 116, protein_g: 6, fat_g: 2, carbs_g: 20 },
  default_portion: { grams: 300, unit: '份' },
}

const intake: IntakeResult = {
  food_name: '宫保鸡丁', grams: 300, calories: 348, protein_g: 18, fat_g: 6, carbs_g: 60,
  per_100g: { calories: 116, protein_g: 6, fat_g: 2, carbs_g: 20 },
}

beforeEach(() => {
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  getDietLogsMock.mockReset()
  deleteDietLogMock.mockReset()
  uploadImageMock.mockReset()
  createDietLogMock.mockReset()
  identifyFoodMock.mockReset()
  calculateIntakeMock.mockReset()
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

// ============================================================
// 拍照识别流程（FoodFlow）测试
// ============================================================

describe('Diary 拍照识别流程（FoodFlow）', () => {
  it('上传→识别→选候选→调克数→保存 完整流程', async () => {
    getDietLogsMock.mockResolvedValue([])
    uploadImageMock.mockResolvedValue({ id: 99, filename: 'meal.png', mime_type: 'image/png', size: 1 })
    identifyFoodMock.mockResolvedValue([candidate])
    calculateIntakeMock.mockResolvedValue(intake)
    createDietLogMock.mockResolvedValue(record)

    const user = userEvent.setup()
    const { container } = render(<Diary />)
    await waitFor(() => expect(screen.getByText(/今天还没有记录/)).toBeInTheDocument())

    // 1. 打开拍照流程
    await user.click(screen.getByRole('button', { name: /拍照记录/ }))
    expect(screen.getByText(/拍一张你的食物照片/)).toBeInTheDocument()

    // 2. 选择图片 → 触发上传 + 识别
    const fileInput = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] } })

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalled(), { timeout: 2000 })
    expect(identifyFoodMock).toHaveBeenCalledWith(99)

    // 3. 候选列表展示，选择菜名
    const candidateBtn = await screen.findByRole('button', { name: /宫保鸡丁/ })
    await user.click(candidateBtn)

    // 4. 份量步骤：500ms 防抖后估算营养
    await waitFor(() => expect(calculateIntakeMock).toHaveBeenCalledWith('宫保鸡丁', 300), { timeout: 2000 })
    await waitFor(() => expect(screen.getByText(/预计摄入/)).toBeInTheDocument(), { timeout: 2000 })

    // 5. 确认保存
    await user.click(screen.getByRole('button', { name: /确认记录/ }))
    await waitFor(() => expect(createDietLogMock).toHaveBeenCalled(), { timeout: 2000 })

    const saved = createDietLogMock.mock.calls[0][0]
    expect(saved.food_name).toBe('宫保鸡丁')
    expect(saved.calories).toBe(348)
    expect(saved.image_id).toBe(99)
    // 流程关闭，回到日记页
    await waitFor(() => expect(screen.queryByText(/拍一张你的食物照片/)).not.toBeInTheDocument())
  })

  it('识别失败时回到拍照步骤并提示', async () => {
    getDietLogsMock.mockResolvedValue([])
    uploadImageMock.mockResolvedValue({ id: 99 })
    identifyFoodMock.mockRejectedValue(new Error('识别服务异常'))

    const user = userEvent.setup()
    const { container } = render(<Diary />)
    await waitFor(() => expect(screen.getByText(/今天还没有记录/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /拍照记录/ }))
    const fileInput = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] } })

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('识别失败')), { timeout: 2000 })
    // 回到拍照步骤
    await waitFor(() => expect(screen.getByText(/拍一张你的食物照片/)).toBeInTheDocument())
  })
})
