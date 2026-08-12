import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Login from './Login'
import { useAuthStore } from '../stores/auth'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

const loginMock = vi.fn()
vi.mock('../api/go', () => ({
  goApi: { login: (...args: unknown[]) => loginMock(...args) },
}))

const toastMock = vi.fn()
vi.mock('../lib/toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}))

beforeEach(() => {
  navigate.mockClear()
  loginMock.mockReset()
  toastMock.mockClear()
  useAuthStore.getState().logout()
})

describe('Login 页面', () => {
  it('渲染登录表单', () => {
    render(<Login />)
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument()
  })

  it('提交成功后写入 auth 并跳转 /chat', async () => {
    loginMock.mockResolvedValue({ token: 'jwt-token', id: 1, username: 'alice' })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('用户名'), 'alice')
    await user.type(screen.getByPlaceholderText('密码'), 'secret123')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('alice', 'secret123'))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/chat'))
    expect(useAuthStore.getState().token).toBe('jwt-token')
  })

  it('登录失败展示错误 toast，不跳转', async () => {
    loginMock.mockRejectedValue(new Error('用户名或密码错误'))
    const user = userEvent.setup()
    render(<Login />)

    await user.type(screen.getByPlaceholderText('用户名'), 'alice')
    await user.type(screen.getByPlaceholderText('密码'), 'wrong-pass')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('用户名或密码错误'))
    expect(navigate).not.toHaveBeenCalled()
  })
})
