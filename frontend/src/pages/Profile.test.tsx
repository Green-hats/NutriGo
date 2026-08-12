import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('退出登录调用远端吊销并跳转登录页', async () => {
    getProfileMock.mockResolvedValue(profile)
    const user = userEvent.setup()
    render(<Profile />)

    await waitFor(() => expect(screen.getByDisplayValue('175')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /退出登录/ }))

    expect(logoutRemoteMock).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(useAuthStore.getState().token).toBeNull()
  })
})
