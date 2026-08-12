import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { goApi } from '../api/go'
import { useAuthStore } from '../stores/auth'
import { LoadingButton } from '../components/ui/LoadingButton'
import { toast } from '../lib/toast'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const data = await goApi.login(username, password)
      setAuth(data.token, { id: data.id, username: data.username }, data.refresh_token)
      navigate('/chat')
    } catch (err) {
      toast(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-green-600">NutriGo</h1>
        <p className="text-gray-500 mt-2">你的 AI 营养师</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input className="border border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-green-500" placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input className="border border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-green-500" type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <LoadingButton loading={loading} type="submit" className="bg-green-600 text-white">登录</LoadingButton>
      </form>
      <p className="text-center text-sm text-gray-400 mt-6">还没有账号？<Link to="/register" className="text-green-600">注册</Link></p>
    </div>
  )
}
