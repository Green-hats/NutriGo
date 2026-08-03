import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/auth'
import { goApi } from '../api/go'
import { useNavigate } from 'react-router-dom'
import { Loader2, LogOut } from 'lucide-react'
import { LoadingButton } from '../components/ui/LoadingButton'
import { ErrorBlock } from '../components/ui/ErrorBlock'
import { Skeleton } from '../components/ui/Skeleton'
import { toast } from '../components/ui/Toast'
import type { UserProfile } from '../types'

export default function Profile() {
  const { user, setProfile, logout } = useAuthStore()
  const navigate = useNavigate()
  const [form, setForm] = useState<UserProfile>({ height_cm: 0, weight_kg: 0, age: 0, gender: '', goal: '', allergies: [], dietary_habits: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadProfile = () => {
    if (!user) return
    setLoading(true)
    setError('')
    goApi.getProfile().then(setForm).catch(() => setError('加载失败')).finally(() => setLoading(false))
  }
  useEffect(loadProfile, [user])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    try {
      await goApi.updateProfile(form)
      setProfile(form)
      toast('档案已保存', 'success')
    } catch (err: any) {
      toast(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => { logout(); navigate('/login') }

  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold">健康档案</div>
      <div className="p-6 space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <Skeleton className="h-12" />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold">健康档案</div>
      {error ? <ErrorBlock message={error} onRetry={loadProfile} /> : (
        <div className="p-6 space-y-4">
          <Card title="基本信息">
            <div className="grid grid-cols-2 gap-3">
              <Field label="身高(cm)" value={form.height_cm} onChange={(v) => setForm({ ...form, height_cm: v })} />
              <Field label="体重(kg)" value={form.weight_kg} onChange={(v) => setForm({ ...form, weight_kg: v })} />
              <Field label="年龄" value={form.age} onChange={(v) => setForm({ ...form, age: v })} />
              <Select label="性别" value={form.gender} options={['male', 'female', 'other']} onChange={(v) => setForm({ ...form, gender: v })} />
            </div>
          </Card>
          <Card title="目标">
            <Select label="健康目标" value={form.goal} options={['lose_weight', 'maintain', 'gain_muscle']} labels={['减重', '维持体重', '增肌']} onChange={(v) => setForm({ ...form, goal: v })} />
          </Card>
          <Card title="过敏原"><TagInput value={form.allergies} onChange={(v) => setForm({ ...form, allergies: v })} placeholder="添加过敏原" /></Card>
          <Card title="饮食习惯"><TagInput value={form.dietary_habits} onChange={(v) => setForm({ ...form, dietary_habits: v })} placeholder="如: 素食、不吃猪肉" /></Card>
          <LoadingButton loading={saving} onClick={handleSave} className="w-full bg-green-600 text-white">保存</LoadingButton>
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-gray-400 py-3"><LogOut size={18} />退出登录</button>
        </div>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl p-4 shadow-sm"><div className="text-sm text-gray-400 mb-2">{title}</div>{children}</div>
}
function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <div><label className="text-xs text-gray-400">{label}</label><input type="number" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500" value={value || ''} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} /></div>
}
function Select({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (v: string) => void }) {
  return <div><label className="text-xs text-gray-400">{label}</label><select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500 bg-white" value={value} onChange={(e) => onChange(e.target.value)}><option value="">请选择</option>{options.map((o, i) => <option key={o} value={o}>{labels?.[i] || o}</option>)}</select></div>
}
function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('')
  return <div>
    <div className="flex flex-wrap gap-2 mb-2">{value.map((t) => <span key={t} className="bg-gray-100 rounded-full px-3 py-1 text-xs flex items-center gap-1">{t}<button onClick={() => onChange(value.filter((x) => x !== t))} className="text-gray-400">×</button></span>)}</div>
    <div className="flex gap-2"><input className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (() => { const t = input.trim(); if (t && !value.includes(t)) { onChange([...value, t]); setInput('') } })()} /><button onClick={() => { const t = input.trim(); if (t && !value.includes(t)) { onChange([...value, t]); setInput('') } }} className="bg-gray-100 rounded-lg px-3 py-1.5 text-sm">添加</button></div>
  </div>
}
