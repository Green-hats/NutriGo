import { useState } from 'react'
import { useNavigate, Link as RouterLink } from 'react-router-dom'
import { Link, Stack, TextField } from '@mui/material'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import { goApi } from '../api/go'
import { LoadingButton } from '../components/ui/LoadingButton'
import AuthLayout from '../components/layout/AuthLayout'
import { toast } from '../lib/toast'

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      await goApi.register(username, password)
      toast('注册成功', 'success')
      navigate('/login')
    } catch (err) {
      toast(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout
      title="开启健康新日常"
      subtitle="创建账号，记录属于你的第一餐。"
      footer={
        <>
          已有账号？{' '}
          <Link
            component={RouterLink}
            to="/login"
            underline="hover"
            sx={{ fontWeight: 700 }}
          >
            去登录
          </Link>
        </>
      }
    >
      <Stack component="form" onSubmit={handleSubmit} spacing={2.5}>
        <TextField
          label="用户名"
          placeholder="用户名 (3-32字符)"
          helperText="3–32 个字符"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          slotProps={{
            htmlInput: {
              minLength: 3,
              maxLength: 32,
              autoCapitalize: 'none',
              spellCheck: false
            }
          }}
        />
        <TextField
          label="密码"
          placeholder="密码 (6-128字符)"
          helperText="6–128 个字符"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          slotProps={{ htmlInput: { minLength: 6, maxLength: 128 } }}
        />
        <LoadingButton
          loading={loading}
          type="submit"
          fullWidth
          endIcon={<ArrowForwardRounded />}
          sx={{ minHeight: 52 }}
        >
          注册
        </LoadingButton>
      </Stack>
    </AuthLayout>
  )
}
