import { errorMessage } from '../lib/connection'
import { useState, useEffect } from 'react'
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import { useAuthStore } from '../stores/auth'
import { goApi } from '../api/go'
import { logoutRemote } from '../api/authSession'
import { useNavigate } from 'react-router-dom'
import { LoadingButton } from '../components/ui/LoadingButton'
import { ErrorBlock } from '../components/ui/ErrorBlock'
import { Skeleton } from '../components/ui/Skeleton'
import { PageHeader } from '../components/layout/PageHeader'
import { isPreviewBuild, previewUser, usePreviewStore } from '../lib/preview'
import { toast } from '../lib/toast'
import type { UserProfile } from '../types'

const DISEASE_OPTIONS = [
  { value: 'hypertension', label: '高血压' },
  { value: 'diabetes', label: '糖尿病' },
  { value: 'hyperlipidemia', label: '高血脂' },
  { value: 'gout', label: '痛风' },
  { value: 'heart_disease', label: '心脏病' },
  { value: 'kidney_disease', label: '肾病' },
  { value: 'digestive_disease', label: '消化系统疾病' }
]

export default function Profile() {
  const { user: signedInUser, setProfile, logout } = useAuthStore()
  const preview = usePreviewStore((s) => s.active)
  const user = isPreviewBuild() && preview ? previewUser : signedInUser
  const navigate = useNavigate()
  const [form, setForm] = useState<UserProfile>({
    height_cm: 0,
    weight_kg: 0,
    age: 0,
    gender: '',
    goal: '',
    allergies: [],
    dietary_habits: [],
    chronic_diseases: []
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadProfile = () => {
    if (!user) return
    setLoading(true)
    setError('')
    goApi
      .getProfile()
      .then(setForm)
      .catch((err) => setError(errorMessage(err, '档案加载失败')))
      .finally(() => setLoading(false))
  }
  useEffect(loadProfile, [user])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    try {
      await goApi.updateProfile(form)
      setProfile(form)
      toast('档案已保存', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => {
    if (isPreviewBuild()) {
      usePreviewStore.getState().exit()
      navigate('/login')
      return
    }
    void logoutRemote() // 先捕获当前令牌，远端吊销不阻塞本地退出。
    logout()
    navigate('/login')
  }

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        eyebrow="A HEALTHIER YOU"
        title="健康档案"
        subtitle="更了解你，才能给出更贴心的建议。"
      />
      <Stack spacing={2.5} sx={{ px: 3 }}>
        <Paper sx={{ p: 2.5, bgcolor: '#E9F0E2' }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Avatar
              sx={{
                width: 56,
                height: 56,
                bgcolor: 'primary.main',
                fontWeight: 700,
                fontSize: 24
              }}
            >
              {user?.username.slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" sx={{ overflowWrap: 'anywhere' }}>
                {user?.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                把照顾自己，变成每天的小习惯。
              </Typography>
            </Box>
          </Stack>
        </Paper>
        {loading ? (
          <>
            <Skeleton height={180} />
            <Skeleton height={120} />
            <Skeleton />
          </>
        ) : error ? (
          <ErrorBlock message={error} onRetry={loadProfile} />
        ) : (
          <>
            <Section
              title="基本信息"
              description="用于更准确地了解你的身体情况。"
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 2.5
                }}
              >
                <Field
                  label="身高(cm)"
                  value={form.height_cm}
                  onChange={(v) => setForm({ ...form, height_cm: v })}
                />
                <Field
                  label="体重(kg)"
                  value={form.weight_kg}
                  onChange={(v) => setForm({ ...form, weight_kg: v })}
                />
                <Field
                  label="年龄"
                  value={form.age}
                  onChange={(v) => setForm({ ...form, age: v })}
                />
                <TextField
                  label="性别"
                  select
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  slotProps={{
                    select: { native: true },
                    inputLabel: { shrink: true }
                  }}
                >
                  <option value="">请选择</option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                  <option value="other">其他</option>
                </TextField>
              </Box>
            </Section>
            <Section
              title="我的健康目标"
              description="朝着适合自己的方向，慢慢来。"
            >
              <ToggleButtonGroup
                exclusive
                fullWidth
                value={form.goal}
                onChange={(_e, value: string | null) => {
                  if (value) setForm({ ...form, goal: value })
                }}
                aria-label="健康目标"
                sx={{
                  '& .MuiToggleButton-root': {
                    px: 1,
                    py: 1.5,
                    fontSize: 13,
                    '&.Mui-selected': {
                      color: 'primary.main',
                      bgcolor: '#E8F0E3',
                      borderColor: '#AFC5A4'
                    }
                  }
                }}
              >
                <ToggleButton value="lose_weight">减重</ToggleButton>
                <ToggleButton value="maintain">维持体重</ToggleButton>
                <ToggleButton value="gain_muscle">增肌</ToggleButton>
              </ToggleButtonGroup>
            </Section>
            <Section title="过敏原" description="记下需要避开的食物。">
              <TagInput
                value={form.allergies}
                onChange={(v) => setForm({ ...form, allergies: v })}
                placeholder="添加过敏原"
              />
            </Section>
            <Section
              title="饮食习惯"
              description="每一种饮食偏好，都值得被尊重。"
            >
              <TagInput
                value={form.dietary_habits}
                onChange={(v) => setForm({ ...form, dietary_habits: v })}
                placeholder="如: 素食、不吃猪肉"
              />
            </Section>
            <Section
              title="健康情况"
              description="基础病（可多选），帮助我们考虑你的饮食需求。"
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {DISEASE_OPTIONS.map((o) => {
                  const active = form.chronic_diseases.includes(o.value)
                  return (
                    <Chip
                      key={o.value}
                      label={o.label}
                      component="button"
                      type="button"
                      aria-pressed={active}
                      icon={
                        active ? (
                          <CheckCircleRounded />
                        ) : (
                          <FavoriteBorderRounded />
                        )
                      }
                      onClick={() =>
                        setForm({
                          ...form,
                          chronic_diseases: active
                            ? form.chronic_diseases.filter((x) => x !== o.value)
                            : [...form.chronic_diseases, o.value]
                        })
                      }
                      variant={active ? 'filled' : 'outlined'}
                      color={active ? 'primary' : 'default'}
                      sx={{ height: 42, borderRadius: 3, px: 0.5 }}
                    />
                  )
                })}
              </Box>
            </Section>
            <LoadingButton
              loading={saving}
              onClick={handleSave}
              fullWidth
              sx={{ minHeight: 52 }}
            >
              保存档案
            </LoadingButton>
          </>
        )}
        <Button
          onClick={handleLogout}
          startIcon={<LogoutRounded />}
          sx={{ color: 'text.secondary' }}
        >
          退出登录
        </Button>
      </Stack>
    </Box>
  )
}

function Section({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Paper
      component="section"
      sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}
    >
      <Typography variant="h3">{title}</Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5, mb: 2.5 }}
      >
        {description}
      </Typography>
      {children}
    </Paper>
  )
}
function Field({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <TextField
      label={label}
      type="number"
      value={value || ''}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      slotProps={{
        htmlInput: { min: 0, inputMode: 'decimal' },
        inputLabel: { shrink: true }
      }}
    />
  )
}
function TagInput({
  value,
  onChange,
  placeholder
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const t = input.trim()
    if (t && !value.includes(t)) {
      onChange([...value, t])
      setInput('')
    }
  }
  return (
    <Stack spacing={1.5}>
      {value.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {value.map((t) => (
            <Chip
              key={t}
              label={t}
              onDelete={() => onChange(value.filter((x) => x !== t))}
              sx={{ bgcolor: '#EEF3E9', maxWidth: '100%' }}
            />
          ))}
        </Box>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': placeholder } }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              add()
            }
          }}
        />
        <IconButton
          aria-label={placeholder}
          onClick={add}
          disabled={!input.trim()}
          sx={{ bgcolor: '#EAF1E4', color: 'primary.main' }}
        >
          <AddRounded />
        </IconButton>
      </Stack>
    </Stack>
  )
}
