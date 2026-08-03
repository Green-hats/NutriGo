import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { goApi } from '../api/go'
import { useAuthStore } from '../stores/auth'

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const data = await goApi.register(username, password)
      setAuth('registered', { id: data.id, username: data.username })
      navigate('/login')
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-green-600">NutriGo</h1>
        <p className="text-gray-500 mt-2">创建你的账号</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          className="border border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-green-500"
          placeholder="用户名 (3-32字符)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={32}
        />
        <input
          className="border border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-green-500"
          type="password"
          placeholder="密码 (6-128字符)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          className="bg-green-600 text-white rounded-xl py-3 text-base font-medium hover:bg-green-700 transition-colors"
        >
          注册
        </button>
      </form>

      <p className="text-center text-sm text-gray-400 mt-6">
        已有账号？{' '}
        <Link to="/login" className="text-green-600">
          登录
        </Link>
      </p>
    </div>
  )
}
