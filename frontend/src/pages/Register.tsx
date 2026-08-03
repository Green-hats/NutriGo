import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { goApi } from '../api/go'
import { LoadingButton } from '../components/ui/LoadingButton'
import { toast } from '../components/ui/Toast'

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await goApi.register(username, password)
      toast('注册成功', 'success')
      navigate('/login')
    } catch (err: any) {
      toast(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-green-600">NutriGo</h1>
        <p className="text-gray-500 mt-2">创建你的账号</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input className="border border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-green-500" placeholder="用户名 (3-32字符)" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} />
        <input className="border border-gray-200 rounded-xl px-4 py-3 text-base outline-none focus:border-green-500" type="password" placeholder="密码 (6-128字符)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <LoadingButton loading={loading} type="submit" className="bg-green-600 text-white">注册</LoadingButton>
      </form>
      <p className="text-center text-sm text-gray-400 mt-6">已有账号？<Link to="/login" className="text-green-600">登录</Link></p>
    </div>
  )
}
