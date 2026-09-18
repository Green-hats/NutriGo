import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Profile from './Profile'
import { useAuthStore } from '../stores/auth'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}))

const getProfileMock = vi.fn()
const updateProfileMock = vi.fn()
vi.mock('../api/go', () => ({
  goApi: {
    getProfile: (...args: unknown[]) => getProfileMock(...args),
    updateProfile: (...args: unknown[]) => updateProfileMock(...args),
  },
}))

const logoutRemoteMock = vi.fn()
vi.mock('../api/authSession', () => ({
  logoutRemote: (...args: unknown[]) => logoutRemoteMock(...args),
}))

const toastMock = vi.fn()
vi.mock('../lib/toast', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))

const profile = {
  id: 1, user_id: 1, height_cm: 175, weight_kg: 78, age: 32, gender: 'male',
  goal: 'lose_weight', allergies: ['peanut'], dietary_habits: [], chronic_diseases: ['hypertension'],
}

beforeEach(() => {
  useAuthStore.getState().setAuth('token', { id: 1, username: 'u' })
  useAuthStore.getState().setProfile(profile)
  navigate.mockClear()
  getProfileMock.mockReset()
  updateProfileMock.mockReset()
  logoutRemoteMock.mockReset()
  toastMock.mockClear()
})

describe('Profile 健康档案页', () => {
  it('加载并展示档案数据', async () => {
    getProfileMock.mockResolvedValue(profile)
    render(<Profile />)

    await waitFor(() => expect(screen.getByDisplayValue('175')).toBeInTheDocument())
    expect(screen.getByDisplayValue('78')).toBeInTheDocument()
    expect(screen.getByText('高血压')).toBeInTheDocument()
  })

  it('保存调用 updateProfile 并提示成功', async () => {
    getProfileMock.mockResolvedValue(profile)
    updateProfileMock.mockResolvedValue({ ...profile, height_cm: 180 })
    const user = userEvent.setup()
    render(<Profile />)

    await waitFor(() => expect(screen.getByDisplayValue('175')).toBeInTheDocument())
    const heightInput = screen.getByDisplayValue('175')
    await user.clear(heightInput)
    await user.type(heightInput, '180')
    await user.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalled())
    expect(updateProfileMock.mock.calls[0][0].height_cm).toBe(180)
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('档案已保存', 'success'))
  })

  it('加载失败展示错误与重试', async () => {
    getProfileMock.mockRejectedValue(new Error('加载失败'))
    render(<Profile />)

    await waitFor(() => expect(screen.getByText(/加载失败/)).toBeInTheDocument())
  })

  it.each(['10.9', '-1', '151'])('无效年龄 %s 在输入处提示并阻止提交，保留填写内容', async (age) => {
    getProfileMock.mockResolvedValue(profile)
    render(<Profile />)
    const input = await screen.findByLabelText('年龄')
    fireEvent.change(input, { target: { value: age } })
    fireEvent.click(screen.getByRole('button', { name: '保存档案' }))

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('年龄请输入 0–150 之间的整数')
    expect(input).toHaveFocus()
    expect(input).toHaveValue(Number(age))
    expect(updateProfileMock).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().profile?.age).toBe(32)
  })

  it('修正小数年龄后可保存，身高体重仍支持小数', async () => {
    getProfileMock.mockResolvedValue(profile)
    updateProfileMock.mockResolvedValue({ ...profile, age: 11, height_cm: 175.5, weight_kg: 68.2 })
    render(<Profile />)
    const input = await screen.findByLabelText('年龄')
    fireEvent.change(input, { target: { value: '10.9' } })
    fireEvent.click(screen.getByRole('button', { name: '保存档案' }))
    expect(updateProfileMock).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '11' } })
    fireEvent.change(screen.getByLabelText('身高(cm)'), { target: { value: '175.5' } })
    fireEvent.change(screen.getByLabelText('体重(kg)'), { target: { value: '68.2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存档案' }))
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith(expect.objectContaining({
      age: 11, height_cm: 175.5, weight_kg: 68.2
    })))
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('step', '1')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('档案已保存', 'success'))
  })

  it('未填写年龄时仍可保存其他档案信息', async () => {
    getProfileMock.mockResolvedValue(profile)
    updateProfileMock.mockResolvedValue({ ...profile, age: 0 })
    const user = userEvent.setup()
    render(<Profile />)
    await user.clear(await screen.findByLabelText('年龄'))
    await user.click(screen.getByRole('button', { name: '保存档案' }))
    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith(expect.objectContaining({ age: 0 })))
  })

  it('退出登录调用远端吊销并跳转登录页', async () => {
    getProfileMock.mockResolvedValue(profile)
    // 模拟无响应的网络，不能阻塞本地清理和导航。
    logoutRemoteMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<Profile />)

    await waitFor(() => expect(screen.getByDisplayValue('175')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /退出登录/ }))

    expect(logoutRemoteMock).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(useAuthStore.getState().token).toBeNull()
  })
})
