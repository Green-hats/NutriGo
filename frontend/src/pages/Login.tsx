import { useState } from 'react'
import { useNavigate, Link as RouterLink } from 'react-router-dom'
import {
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField
} from '@mui/material'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import VisibilityRounded from '@mui/icons-material/VisibilityRounded'
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded'
import { goApi } from '../api/go'
import { useAuthStore } from '../stores/auth'
import { LoadingButton } from '../components/ui/LoadingButton'
import AuthLayout from '../components/layout/AuthLayout'
import { toast } from '../lib/toast'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      const data = await goApi.login(username, password)
      setAuth(
        data.token,
        { id: data.id, username: data.username },
        data.refresh_token
      )
      navigate('/chat')
    } catch (err) {
      toast(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout
      title="欢迎回来"
      subtitle="登录 NutriGo，继续你的健康日常。"
      footer={
        <>
          还没有账号？{' '}
          <Link
            component={RouterLink}
            to="/register"
            underline="hover"
            sx={{ fontWeight: 700 }}
          >
            创建账号
          </Link>
        </>
      }
    >
      <Stack component="form" onSubmit={handleSubmit} spacing={2.5}>
        <TextField
          label="用户名"
          placeholder="用户名"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          slotProps={{
            htmlInput: { autoCapitalize: 'none', spellCheck: false }
          }}
        />
        <TextField
          label="密码"
          placeholder="密码"
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={visible ? '隐藏密码' : '显示密码'}
                    onClick={() => setVisible(!visible)}
                    edge="end"
                  >
                    <VisibilityToggle visible={visible} />
                  </IconButton>
                </InputAdornment>
              )
            }
          }}
        />
        <LoadingButton
          loading={loading}
          type="submit"
          fullWidth
          endIcon={<ArrowForwardRounded />}
          sx={{ minHeight: 52 }}
        >
          登录
        </LoadingButton>
      </Stack>
    </AuthLayout>
  )
}
function VisibilityToggle({ visible }: { visible: boolean }) {
  return visible ? (
    <VisibilityOffRounded fontSize="small" />
  ) : (
    <VisibilityRounded fontSize="small" />
  )
}
