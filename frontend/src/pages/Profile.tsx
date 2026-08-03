import { useState, useEffect } from 'react'
import { useAuthStore } from '../stores/auth'
import { goApi } from '../api/go'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import type { UserProfile } from '../types'

export default function Profile() {
  const { user, token, setProfile, logout } = useAuthStore()
  const navigate = useNavigate()
  const [form, setForm] = useState<UserProfile>({
    height_cm: 0, weight_kg: 0, age: 0,
    gender: '', goal: '',
    allergies: [], dietary_habits: [],
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    goApi.getProfile().then(setForm).catch(() => {})
  }, [user])

  const handleSave = async () => {
    if (!user) return
    await goApi.updateProfile(form)
    setProfile(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold">
        健康档案
      </div>

      <div className="p-6 space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-sm text-gray-400 mb-1">基本信息</div>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="身高(cm)" value={form.height_cm} onChange={(v) => setForm({ ...form, height_cm: v })} />
            <InputField label="体重(kg)" value={form.weight_kg} onChange={(v) => setForm({ ...form, weight_kg: v })} />
            <InputField label="年龄" value={form.age} onChange={(v) => setForm({ ...form, age: v })} />
            <SelectField label="性别" value={form.gender} options={['male', 'female', 'other']} onChange={(v) => setForm({ ...form, gender: v })} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-sm text-gray-400 mb-1">目标</div>
          <SelectField
            label="健康目标"
            value={form.goal}
            options={['lose_weight', 'maintain', 'gain_muscle']}
            labels={['减重', '维持体重', '增肌']}
            onChange={(v) => setForm({ ...form, goal: v })}
          />
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-sm text-gray-400 mb-1">过敏原</div>
          <TagInput
            value={form.allergies}
            onChange={(v) => setForm({ ...form, allergies: v })}
            placeholder="添加过敏原"
          />
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-sm text-gray-400 mb-1">饮食习惯</div>
          <TagInput
            value={form.dietary_habits}
            onChange={(v) => setForm({ ...form, dietary_habits: v })}
            placeholder="如: 素食、不吃猪肉"
          />
        </div>

        <button onClick={handleSave} className="w-full bg-green-600 text-white rounded-xl py-3 font-medium">
          {saved ? '✅ 已保存' : '保存'}
        </button>

        <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-gray-400 py-3">
          <LogOut size={18} /> 退出登录
        </button>
      </div>
    </div>
  )
}

function InputField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type="number"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  )
}

function SelectField({ label, value, options, labels, onChange }: {
  label: string; value: string; options: string[]; labels?: string[]; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs text-gray-400">{label}</label>
      <select
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500 bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">请选择</option>
        {options.map((opt, i) => (
          <option key={opt} value={opt}>{labels?.[i] || opt}</option>
        ))}
      </select>
    </div>
  )
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('')

  const add = () => {
    const tag = input.trim()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
      setInput('')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((t) => (
          <span key={t} className="bg-gray-100 rounded-full px-3 py-1 text-xs flex items-center gap-1">
            {t}
            <button onClick={() => onChange(value.filter((x) => x !== t))} className="text-gray-400">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-green-500"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button onClick={add} className="bg-gray-100 rounded-lg px-3 py-1.5 text-sm">添加</button>
      </div>
    </div>
  )
}
