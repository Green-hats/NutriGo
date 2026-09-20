import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  render,
  screen,
  waitFor,
  within,
  fireEvent
} from '@testing-library/react'
import { deferred } from '../test/deferred'
import userEvent from '@testing-library/user-event'
import Diary from './Diary'
import { useAuthStore } from '../stores/auth'
import type { DietRecord, MealAnalysis } from '../types'

vi.mock('../lib/foodImage', () => ({
  MAX_FOOD_IMAGE_BYTES: 10 * 1024 * 1024,
  prepareFoodImage: async (file: File) => file
}))

const getDietLogsMock = vi.fn()
const deleteDietLogMock = vi.fn()
const uploadImageMock = vi.fn()
const createDietLogMock = vi.fn()
const updateDietLogMock = vi.fn()
const createDietBatchMock = vi.fn()
vi.mock('../api/go', () => ({
  goApi: {
    getDietLogs: (...args: unknown[]) => getDietLogsMock(...args),
    deleteDietLog: (...args: unknown[]) => deleteDietLogMock(...args),
    uploadImage: (...args: unknown[]) => uploadImageMock(...args),
    createDietLog: (...args: unknown[]) => createDietLogMock(...args),
    updateDietLog: (...args: unknown[]) => updateDietLogMock(...args),
    createDietBatch: (...args: unknown[]) => createDietBatchMock(...args)
  }
}))

const analyzeMealMock = vi.fn()
vi.mock('../api/agent', () => ({
  agentApi: { analyzeMeal: (...args: unknown[]) => analyzeMealMock(...args) }
}))

const toastMock = vi.fn()
vi.mock('../lib/toast', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))

vi.mock('../components/diary/NutritionChart', () => ({
  default: () => <div data-testid="chart" />
}))

const record: DietRecord = {
  id: 1,
  user_id: 1,
  date: '2026-08-12',
  meal_type: 'lunch',
  food_name: '宫保鸡丁',
  portion: '1份',
  calories: 450,
  protein_g: 30,
  fat_g: 22,
  carbs_g: 35,
  created_at: '2026-08-12T10:00:00Z'
}

const analysis: MealAnalysis = {
  model: 'deepseek-flash', note: '请按实际份量修改',
  items: [
    { name: '宫保鸡丁', grams: 200, grams_low: 150, grams_high: 280,
      nutrition_per_100g: { calories: 200, protein_g: 15, fat_g: 12, carbs_g: 8 },
      nutrition_source: 'model', assumption: '烹饪用油为估算' },
    { name: '米饭', grams: 150, grams_low: 100, grams_high: 200,
      nutrition_per_100g: { calories: 116, protein_g: 2.6, fat_g: 0.3, carbs_g: 25.9 },
      nutrition_source: 'database', assumption: '按普通饭碗估算' }
  ]
}

beforeEach(() => {
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  getDietLogsMock.mockReset()
  deleteDietLogMock.mockReset()
  uploadImageMock.mockReset()
  createDietLogMock.mockReset()
  updateDietLogMock.mockReset()
  analyzeMealMock.mockReset()
  createDietBatchMock.mockReset()
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

    await waitFor(() =>
      expect(screen.getByText(/今天还没有记录/)).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /拍照记录/ })).toBeInTheDocument()
  })

  it('删除记录调用 deleteDietLog 并重新拉取', async () => {
    getDietLogsMock.mockResolvedValue([record])
    deleteDietLogMock.mockResolvedValue({})
    const user = userEvent.setup()
    render(<Diary />)

    await waitFor(() =>
      expect(screen.getByText('宫保鸡丁')).toBeInTheDocument()
    )
    const recordCard = screen.getByRole('article', { name: '宫保鸡丁记录' })
    await user.click(within(recordCard).getByRole('button', { name: '删除记录' }))

    expect(deleteDietLogMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteDietLogMock).not.toHaveBeenCalled()
    await user.click(await within(recordCard).findByRole('button', { name: '删除记录' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteDietLogMock).toHaveBeenCalledWith(1))
    // 删除后触发重新加载
    await waitFor(() => expect(getDietLogsMock).toHaveBeenCalledTimes(2))
  })

  it('点击图表按钮打开趋势图', async () => {
    getDietLogsMock.mockResolvedValue([])
    const user = userEvent.setup()
    render(<Diary />)

    const chartButton = screen.getByRole('button', { name: '查看营养趋势' })
    await user.click(chartButton)
    await waitFor(() => expect(screen.getByTestId('chart')).toBeInTheDocument())
  })
})

// ============================================================
// 拍照识别流程（FoodFlow）测试
// ============================================================

describe('Diary DeepSeek 照片分析', () => {
  async function openAnalysis() {
    getDietLogsMock.mockResolvedValue([])
    uploadImageMock.mockResolvedValue({ id: 99 })
    analyzeMealMock.mockResolvedValue(analysis)
    render(<Diary />)
    fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
    fireEvent.click(screen.getByRole('button', { name: '午餐' }))
    fireEvent.change(screen.getByLabelText('选择食物照片'), {
      target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] }
    })
    await screen.findAllByLabelText('食物名称')
  }

  it('选择超过 10 MiB 的照片时立即提示且不上传', async () => {
    getDietLogsMock.mockResolvedValue([])
    render(<Diary />)
    fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
    fireEvent.change(screen.getByLabelText('选择食物照片'), {
      target: {
        files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })],
      },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('照片超过 10 MiB')
    expect(uploadImageMock).not.toHaveBeenCalled()
    expect(analyzeMealMock).not.toHaveBeenCalled()
  })

  it('识别多项食物，修改实际克重后即时重算并统一保存', async () => {
    createDietBatchMock.mockResolvedValue([record])
    await openAnalysis()
    expect(analyzeMealMock).toHaveBeenCalledWith(99, expect.any(AbortSignal))
    expect(screen.getByText(/本餐预计摄入 · 2/)).toBeInTheDocument()
    const inputs = screen.getAllByLabelText('份量（g）')
    expect(inputs[0]).toHaveValue(200)
    fireEvent.change(inputs[0], { target: { value: '100' } })
    expect(screen.getByText('预计 200 kcal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认记录 · 午餐' }))
    await waitFor(() => expect(createDietBatchMock).toHaveBeenCalledTimes(1))
    const [id, saved] = createDietBatchMock.mock.calls[0]
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    expect(saved).toHaveLength(2)
    expect(saved[0]).toEqual(expect.objectContaining({ food_name: '宫保鸡丁', portion: '100g', calories: 200, image_id: 99, meal_type: 'lunch' }))
    expect(saved[1].notes).toContain('营养库')
    expect(analyzeMealMock).toHaveBeenCalledTimes(1)
    expect(createDietLogMock).not.toHaveBeenCalled()
  })

  it.each(['', '0', '-5', '3001'])('克数 %s 无效时不能保存', async value => {
    await openAnalysis()
    fireEvent.change(screen.getAllByLabelText('份量（g）')[0], { target: { value } })
    expect(screen.getByRole('button', { name: /^确认记录/ })).toBeDisabled()
    expect(screen.queryByText(/本餐预计摄入/)).not.toBeInTheDocument()
    expect(createDietBatchMock).not.toHaveBeenCalled()
  })

  it('可移除误识别项、修改每100克的营养和克重', async () => {
    createDietBatchMock.mockResolvedValue([])
    await openAnalysis()
    fireEvent.click(screen.getByRole('button', { name: '移除米饭' }))
    fireEvent.change(screen.getByLabelText('份量（g）'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: '营养详情 · AI 估算' }))
    fireEvent.change(await screen.findByLabelText('热量 (kcal/100g)'), { target: { value: '180' } })
    fireEvent.click(screen.getByRole('button', { name: /^确认记录/ }))
    await waitFor(() => expect(createDietBatchMock).toHaveBeenCalled())
    const saved = createDietBatchMock.mock.calls[0][1]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toEqual(expect.objectContaining({ calories: 180, portion: '100g', notes: expect.stringContaining('用户修正') }))
  })

  it('保存失败保留不可变提交，重试沿用编号且双击不会重复提交', async () => {
    const retry = deferred<DietRecord[]>()
    createDietBatchMock.mockRejectedValueOnce(new Error('网络超时')).mockReturnValueOnce(retry.promise)
    await openAnalysis()
    fireEvent.click(screen.getByRole('button', { name: /^确认记录/ }))
    const button = await screen.findByRole('button', { name: '重试保存' })
    expect(screen.getByText(/重试不会重复记录/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('份量（g）')[0]).toBeDisabled()
    expect(screen.getByRole('button', { name: '晚餐' })).toBeDisabled()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(createDietBatchMock).toHaveBeenCalledTimes(2)
    expect(createDietBatchMock.mock.calls[1]).toEqual(createDietBatchMock.mock.calls[0])
    await act(async () => retry.resolve([record]))
  })

  it('非食物照片没有记录按钮权限，可转手动录入并保留餐次', async () => {
    await openAnalysis()
    fireEvent.click(screen.getByRole('button', { name: '重新拍照' }))
    analyzeMealMock.mockResolvedValue({ ...analysis, items: [], note: '照片没有食物' })
    fireEvent.change(screen.getByLabelText('选择食物照片'), { target: { files: [new File(['x'], 'desk.png', { type: 'image/png' })] } })
    await screen.findByText('照片没有食物')
    expect(screen.getByRole('button', { name: /^确认记录/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '改为手动记录' }))
    expect(screen.getByLabelText(/食物名称/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '午餐' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('分析失败可复用已上传的照片重试', async () => {
    await openAnalysis()
    fireEvent.click(screen.getByRole('button', { name: '重新拍照' }))
    analyzeMealMock.mockRejectedValueOnce(new Error('服务不可用')).mockResolvedValueOnce(analysis)
    fireEvent.change(screen.getByLabelText('选择食物照片'), { target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] } })
    fireEvent.click(await screen.findByRole('button', { name: '重试分析这张照片' }))
    await screen.findAllByLabelText('食物名称')
    expect(uploadImageMock).toHaveBeenCalledTimes(2)
    expect(analyzeMealMock).toHaveBeenCalledTimes(3)
  })

  it('关闭后迟到的上传不会触发模型分析', async () => {
    getDietLogsMock.mockResolvedValue([])
    const pending = deferred<{ id: number }>()
    uploadImageMock.mockReturnValueOnce(pending.promise)
    render(<Diary />)
    fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
    fireEvent.change(screen.getByLabelText('选择食物照片'), { target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] } })
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await act(async () => pending.resolve({ id: 99 }))
    expect(analyzeMealMock).not.toHaveBeenCalled()
  })
})

it('手动录入无需拍照，保存选定餐次和全部营养数值', async () => {
  getDietLogsMock.mockResolvedValue([])
  createDietLogMock.mockResolvedValue(record)
  const user = userEvent.setup()
  render(<Diary />)
  await user.click(screen.getByRole('button', { name: '手动记录' }))
  await user.click(screen.getByRole('button', { name: '早餐' }))
  await user.type(screen.getByLabelText(/食物名称/), '酸奶')
  await user.type(screen.getByLabelText('食用份量'), '200g')
  for (const [label, value] of [['热量', '150'], ['蛋白质', '8'], ['脂肪', '0'], ['碳水', '20']]) {
    await user.type(screen.getByLabelText(new RegExp(label)), value)
  }
  await user.click(screen.getByRole('button', { name: '保存记录' }))
  await waitFor(() => expect(createDietLogMock).toHaveBeenCalledWith(expect.objectContaining({
    meal_type: 'breakfast', food_name: '酸奶', portion: '200g', calories: 150,
    protein_g: 8, fat_g: 0, carbs_g: 20, image_id: null
  })))
  expect(uploadImageMock).not.toHaveBeenCalled()
  expect(analyzeMealMock).not.toHaveBeenCalled()
})

it('编辑已有记录保留图片；保存失败保留表单，重试调用更新接口', async () => {
  getDietLogsMock.mockResolvedValue([{ ...record, image_id: 99 }])
  updateDietLogMock.mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(record)
  const user = userEvent.setup()
  render(<Diary />)
  await user.click(await screen.findByRole('button', { name: '编辑记录' }))
  expect(screen.getByRole('button', { name: '午餐' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '晚餐' }))
  const calories = screen.getByLabelText(/热量/)
  await user.clear(calories)
  await user.type(calories, '0')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
  expect(calories).toHaveValue(0)
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() => expect(updateDietLogMock).toHaveBeenCalledTimes(2))
  expect(updateDietLogMock).toHaveBeenLastCalledWith(1, expect.objectContaining({ meal_type: 'dinner', calories: 0, image_id: 99 }))
  expect(createDietLogMock).not.toHaveBeenCalled()
})

it('快速切换日期时，迟到的旧日期请求不会覆盖当前记录', async () => {
  const old = deferred<DietRecord[]>()
  getDietLogsMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ ...record, food_name: '前一天午餐' }])
  const user = userEvent.setup()
  render(<Diary />)
  await user.click(screen.getByRole('button', { name: '前一天' }))
  expect(await screen.findByText('前一天午餐')).toBeInTheDocument()
  await act(async () => old.resolve([record]))
  expect(screen.queryByText('宫保鸡丁')).not.toBeInTheDocument()
  expect(screen.getByText('前一天午餐')).toBeInTheDocument()
})
