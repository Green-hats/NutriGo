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
import type { DietRecord, IdentifyResult, IntakeResult } from '../types'

vi.mock('../lib/foodImage', () => ({
  prepareFoodImage: async (file: File) => file
}))

const getDietLogsMock = vi.fn()
const deleteDietLogMock = vi.fn()
const uploadImageMock = vi.fn()
const createDietLogMock = vi.fn()
const updateDietLogMock = vi.fn()
vi.mock('../api/go', () => ({
  goApi: {
    getDietLogs: (...args: unknown[]) => getDietLogsMock(...args),
    deleteDietLog: (...args: unknown[]) => deleteDietLogMock(...args),
    uploadImage: (...args: unknown[]) => uploadImageMock(...args),
    createDietLog: (...args: unknown[]) => createDietLogMock(...args),
    updateDietLog: (...args: unknown[]) => updateDietLogMock(...args)
  }
}))

const identifyFoodMock = vi.fn()
const calculateIntakeMock = vi.fn()
vi.mock('../api/agent', () => ({
  agentApi: {
    identifyFood: (...args: unknown[]) => identifyFoodMock(...args),
    calculateIntake: (...args: unknown[]) => calculateIntakeMock(...args)
  }
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

const candidate: IdentifyResult = {
  name: '宫保鸡丁',
  confidence: 0.9,
  nutrition_per_100g: { calories: 116, protein_g: 6, fat_g: 2, carbs_g: 20 },
  default_portion: { grams: 300, unit: '份' }
}

const intake: IntakeResult = {
  food_name: '宫保鸡丁',
  grams: 300,
  calories: 348,
  protein_g: 18,
  fat_g: 6,
  carbs_g: 60,
  per_100g: { calories: 116, protein_g: 6, fat_g: 2, carbs_g: 20 }
}

beforeEach(() => {
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  getDietLogsMock.mockReset()
  deleteDietLogMock.mockReset()
  uploadImageMock.mockReset()
  createDietLogMock.mockReset()
  updateDietLogMock.mockReset()
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

describe('Diary 拍照识别流程（FoodFlow）', () => {
  async function openPortion() {
    getDietLogsMock.mockResolvedValue([])
    uploadImageMock.mockResolvedValue({ id: 99 })
    identifyFoodMock.mockResolvedValue([candidate])
    createDietLogMock.mockResolvedValue(record)
    render(<Diary />)
    fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
    fireEvent.change(screen.getByLabelText('选择食物照片'), {
      target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] }
    })
    fireEvent.click(await screen.findByRole('button', { name: /宫保鸡丁/ }))
  }

  it('修改克数后立即禁止保存，等待对应份量计算完成', async () => {
    const updated = deferred<IntakeResult>()
    calculateIntakeMock
      .mockResolvedValueOnce(intake)
      .mockReturnValueOnce(updated.promise)
    await openPortion()
    const save = screen.getByRole('button', { name: /^确认记录/ })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '400' }
    })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(createDietLogMock).not.toHaveBeenCalled()
    expect(screen.queryByText('预计摄入')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(calculateIntakeMock).toHaveBeenLastCalledWith(candidate.name, 400)
    )
    expect(save).toBeDisabled()
    await act(async () =>
      updated.resolve({ ...intake, grams: 400, calories: 464 })
    )
    await act(async () => {
      fireEvent.click(save)
    })
    expect(createDietLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ portion: '400g', calories: 464 })
    )
  })

  it.each(['success', 'error'])(
    '较慢的旧请求 %s 不能覆盖新份量的计算结果',
    async (status) => {
      const old = deferred<IntakeResult>()
      calculateIntakeMock
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ ...intake, grams: 400, calories: 464 })
      await openPortion()
      await waitFor(() => expect(calculateIntakeMock).toHaveBeenCalledTimes(1))
      fireEvent.change(screen.getByRole('spinbutton'), {
        target: { value: '400' }
      })
      const save = screen.getByRole('button', { name: /^确认记录/ })
      await waitFor(() => expect(save).toBeEnabled())
      await act(async () => {
        if (status === 'success') old.resolve(intake)
        else old.reject(new Error('old request failed'))
      })
      expect(screen.getByText('464')).toBeInTheDocument()
      expect(toastMock).not.toHaveBeenCalled()
      await act(async () => {
        fireEvent.click(save)
      })
      expect(createDietLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ portion: '400g', calories: 464 })
      )
    }
  )

  it('计算过程中清空克数后，迟到的结果也不能恢复保存按钮', async () => {
    const pending = deferred<IntakeResult>()
    calculateIntakeMock.mockReturnValueOnce(pending.promise)
    await openPortion()
    await waitFor(() => expect(calculateIntakeMock).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    await act(async () => pending.resolve(intake))
    expect(screen.getByRole('button', { name: /^确认记录/ })).toBeDisabled()
    expect(screen.queryByText('预计摄入')).not.toBeInTheDocument()
  })

  it.each(['0', '-10', ''])(
    '无效份量 %s 会清除旧结果并禁止保存',
    async (value) => {
      calculateIntakeMock.mockResolvedValue(intake)
      await openPortion()
      const save = screen.getByRole('button', { name: /^确认记录/ })
      await waitFor(() => expect(save).toBeEnabled())
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value } })
      expect(save).toBeDisabled()
      expect(screen.queryByText('预计摄入')).not.toBeInTheDocument()
      fireEvent.click(save)
      expect(createDietLogMock).not.toHaveBeenCalled()
    }
  )

  it('新计算失败后不能保存旧结果', async () => {
    calculateIntakeMock
      .mockResolvedValueOnce(intake)
      .mockRejectedValueOnce(new Error('offline'))
    await openPortion()
    const save = screen.getByRole('button', { name: /^确认记录/ })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '400' }
    })
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.stringContaining('计算失败')
      )
    )
    expect(save).toBeDisabled()
    expect(screen.queryByText('预计摄入')).not.toBeInTheDocument()
  })

  it('关闭面板后取消尚未执行的计算', async () => {
    await openPortion()
    vi.useFakeTimers()
    try {
      fireEvent.change(screen.getByRole('spinbutton'), {
        target: { value: '400' }
      })
      fireEvent.click(screen.getByRole('button', { name: '关闭' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(calculateIntakeMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('上传→识别→选候选→调克数→保存 完整流程', async () => {
    getDietLogsMock.mockResolvedValue([])
    uploadImageMock.mockResolvedValue({
      id: 99,
      filename: 'meal.png',
      mime_type: 'image/png',
      size: 1
    })
    identifyFoodMock.mockResolvedValue([candidate])
    calculateIntakeMock.mockResolvedValue(intake)
    createDietLogMock.mockResolvedValue(record)

    const user = userEvent.setup()
    render(<Diary />)
    await waitFor(() =>
      expect(screen.getByText(/今天还没有记录/)).toBeInTheDocument()
    )

    // 1. 打开拍照流程
    await user.click(screen.getByRole('button', { name: /拍照记录/ }))
    expect(screen.getByText(/拍一张你的食物照片/)).toBeInTheDocument()
    // 进入流程即可手动选择餐次；经过上传、识别和份量计算仍应保持。
    await user.click(screen.getByRole('button', { name: '午餐' }))

    // 2. 选择图片 → 触发上传 + 识别
    const fileInput = screen.getByLabelText('选择食物照片')
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] }
    })

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalled(), {
      timeout: 2000
    })
    expect(identifyFoodMock).toHaveBeenCalledWith(99)

    // 3. 候选列表展示，选择菜名
    const candidateBtn = await screen.findByRole('button', { name: /宫保鸡丁/ })
    await user.click(candidateBtn)

    // 4. 份量步骤：500ms 防抖后估算营养
    await waitFor(
      () => expect(calculateIntakeMock).toHaveBeenCalledWith('宫保鸡丁', 300),
      { timeout: 2000 }
    )
    await waitFor(
      () => expect(screen.getByText(/预计摄入/)).toBeInTheDocument(),
      { timeout: 2000 }
    )

    // 5. 确认保存
    expect(screen.getByRole('button', { name: '午餐' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '确认记录 · 午餐' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /确认记录/ }))
    await waitFor(() => expect(createDietLogMock).toHaveBeenCalled(), {
      timeout: 2000
    })

    const saved = createDietLogMock.mock.calls[0][0]
    expect(saved.food_name).toBe('宫保鸡丁')
    expect(saved.calories).toBe(348)
    expect(saved.image_id).toBe(99)
    expect(saved.meal_type).toBe('lunch')
    // 流程关闭，回到日记页
    await waitFor(() =>
      expect(screen.queryByText(/拍一张你的食物照片/)).not.toBeInTheDocument()
    )
  })

  it('识别失败时回到拍照步骤并提示', async () => {
    getDietLogsMock.mockResolvedValue([])
    uploadImageMock.mockResolvedValue({ id: 99 })
    identifyFoodMock.mockRejectedValue(new Error('识别服务异常'))

    const user = userEvent.setup()
    render(<Diary />)
    await waitFor(() =>
      expect(screen.getByText(/今天还没有记录/)).toBeInTheDocument()
    )

    await user.click(screen.getByRole('button', { name: /拍照记录/ }))
    const fileInput = screen.getByLabelText('选择食物照片')
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'meal.png', { type: 'image/png' })] }
    })

    await waitFor(
      () =>
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('识别失败')
        ),
      { timeout: 2000 }
    )
    // 回到拍照步骤
    await waitFor(() =>
      expect(screen.getByText(/拍一张你的食物照片/)).toBeInTheDocument()
    )
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
  expect(identifyFoodMock).not.toHaveBeenCalled()
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

it('识别候选都不匹配时可转为手动记录', async () => {
  getDietLogsMock.mockResolvedValue([])
  uploadImageMock.mockResolvedValue({ id: 99 })
  identifyFoodMock.mockResolvedValue([candidate])
  render(<Diary />)
  fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
  fireEvent.click(screen.getByRole('button', { name: '晚餐' }))
  fireEvent.change(screen.getByLabelText('选择食物照片'), { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } })
  fireEvent.click(await screen.findByRole('button', { name: '都不是，手动记录' }))
  expect(screen.getByLabelText(/食物名称/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '晚餐' })).toHaveAttribute('aria-pressed', 'true')
  expect(createDietLogMock).not.toHaveBeenCalled()
})
