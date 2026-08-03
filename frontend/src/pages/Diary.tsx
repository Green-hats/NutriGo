import { useState, useRef, useEffect } from 'react'
import { goApi } from '../api/go'
import { agentApi } from '../api/agent'
import { Plus, Camera, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { DietRecord, IdentifyResult } from '../types'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export default function Diary() {
  const [date, setDate] = useState(new Date())
  const [records, setRecords] = useState<DietRecord[]>([])
  const [showFlow, setShowFlow] = useState(false)

  const loadRecords = () => {
    goApi.getDietLogs(formatDate(date)).then(setRecords).catch(() => {})
  }
  useEffect(loadRecords, [date])

  const del = async (id: number) => {
    await goApi.deleteDietLog(id)
    loadRecords()
  }

  const totalCal = records.reduce((s, r) => s + (r.calories || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold">
        饮食日记
      </div>

      {/* 日期选择器 */}
      <div className="bg-white px-4 py-3 flex items-center justify-between border-b">
        <button onClick={() => setDate(addDays(date, -1))}><ChevronLeft /></button>
        <span className="font-medium">{formatDate(date)}</span>
        <button onClick={() => setDate(addDays(date, 1))}><ChevronRight /></button>
      </div>

      {/* 汇总 */}
      <div className="bg-white mx-4 mt-3 rounded-2xl p-4 shadow-sm">
        <div className="text-xs text-gray-400 mb-1">今日摄入</div>
        <div className="text-3xl font-bold text-green-600">{totalCal.toFixed(0)} <span className="text-base font-normal text-gray-400">kcal</span></div>
      </div>

      {/* 记录列表 */}
      <div className="p-4 space-y-3 pb-20">
        {records.length === 0 && (
          <div className="text-center text-gray-400 mt-10">暂无记录，点击右下角 ➕ 添加</div>
        )}
        {records.map((r) => (
          <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm flex justify-between items-center">
            <div>
              <div className="font-medium">{r.food_name}</div>
              <div className="text-xs text-gray-400 mt-1">
                {r.portion} · {r.calories?.toFixed(0)}kcal · 蛋白质{r.protein_g?.toFixed(0)}g
              </div>
            </div>
            <button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={18} /></button>
          </div>
        ))}
      </div>

      {/* 浮动按钮 */}
      <button
        onClick={() => setShowFlow(true)}
        className="fixed bottom-20 right-6 bg-green-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:bg-green-700 transition-colors z-40"
      >
        <Plus size={28} />
      </button>

      {showFlow && <FoodFlow date={formatDate(date)} onDone={() => { loadRecords(); setShowFlow(false) }} onClose={() => setShowFlow(false)} />}
    </div>
  )
}

// ====== 拍照识别流程 ======

function FoodFlow({ date, onDone, onClose }: { date: string; onDone: () => void; onClose: () => void }) {
  const [step, setStep] = useState<'camera' | 'identifying' | 'candidates' | 'portion' | 'saving'>('camera')
  const [imageId, setImageId] = useState(0)
  const [candidates, setCandidates] = useState<IdentifyResult[]>([])
  const [selected, setSelected] = useState<IdentifyResult | null>(null)
  const [grams, setGrams] = useState(300)
  const [estimated, setEstimated] = useState<{ calories: number; protein_g: number; fat_g: number; carbs_g: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setStep('identifying')
    try {
      const img = await goApi.uploadImage(file)
      setImageId(img.id)
      const results = await agentApi.identifyFood(img.id)
      setCandidates(results)
      setStep('candidates')
    } catch (err: any) {
      alert('识别失败: ' + err.message)
      setStep('camera')
    }
  }

  const selectCandidate = async (c: IdentifyResult) => {
    setSelected(c)
    setGrams(c.default_portion.grams)
    setStep('portion')
    updateEstimate(c.name, c.default_portion.grams)
  }

  const updateEstimate = async (foodName: string, g: number) => {
    if (g <= 0) return
    try {
      const r = await agentApi.calculateIntake(foodName, g)
      setEstimated(r)
    } catch {}
  }

  const save = async () => {
    if (!selected || !estimated) return
    setStep('saving')
    try {
      await goApi.createDietLog({
        date,
        meal_type: 'snack',
        food_name: selected.name,
        portion: `${grams}g`,
        calories: estimated.calories,
        protein_g: estimated.protein_g,
        fat_g: estimated.fat_g,
        carbs_g: estimated.carbs_g,
        image_id: imageId,
      })
      onDone()
    } catch (err: any) {
      alert('保存失败: ' + err.message)
      setStep('portion')
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      <div className="bg-green-600 text-white py-4 px-6 flex justify-between items-center">
        <span className="font-semibold">
          {step === 'camera' && '拍照记录'}
          {step === 'identifying' && '识别中...'}
          {step === 'candidates' && '选择食物'}
          {step === 'portion' && '确认份量'}
          {step === 'saving' && '保存中...'}
        </span>
        <button onClick={onClose} className="text-white">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {step === 'camera' && (
          <div className="flex flex-col items-center gap-6 mt-20">
            <Camera size={64} className="text-green-600" />
            <p className="text-gray-500">拍一张你的食物照片</p>
            <button
              onClick={() => fileRef.current?.click()}
              className="bg-green-600 text-white rounded-xl px-8 py-3 font-medium"
            >
              📷 拍照 / 从相册选择
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
          </div>
        )}

        {step === 'identifying' && (
          <div className="flex flex-col items-center gap-4 mt-20">
            <div className="animate-spin w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full" />
            <p className="text-gray-500">AI 正在识别你的食物...</p>
          </div>
        )}

        {step === 'candidates' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400 mb-2">识别结果，请选择一个：</p>
            {candidates.map((c) => (
              <button
                key={c.name}
                onClick={() => selectCandidate(c)}
                className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-left hover:border-green-500 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-green-600">{(c.confidence * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${c.confidence * 100}%` }} />
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  每100g: {c.nutrition_per_100g.calories}kcal · 默认{c.default_portion.grams}g/{c.default_portion.unit}
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 'portion' && selected && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{selected.name}</div>
              <div className="text-sm text-gray-400 mt-1">
                每100g: {selected.nutrition_per_100g.calories}kcal · 蛋白质{selected.nutrition_per_100g.protein_g}g
              </div>
            </div>

            <div className="bg-gray-50 rounded-2xl p-6">
              <label className="text-sm text-gray-400">吃了多少克？</label>
              <div className="flex items-center gap-4 mt-2">
                <button onClick={() => { const g = Math.max(10, grams - 50); setGrams(g); updateEstimate(selected.name, g) }}
                  className="bg-white border rounded-xl w-10 h-10 flex items-center justify-center text-lg">−</button>
                <input
                  type="number"
                  className="flex-1 text-center text-3xl font-bold bg-transparent outline-none"
                  value={grams}
                  onChange={(e) => { const g = parseInt(e.target.value) || 0; setGrams(g); updateEstimate(selected.name, g) }}
                />
                <button onClick={() => { const g = grams + 50; setGrams(g); updateEstimate(selected.name, g) }}
                  className="bg-white border rounded-xl w-10 h-10 flex items-center justify-center text-lg">+</button>
              </div>
              <div className="text-center text-gray-400 text-sm mt-1">克</div>
            </div>

            {estimated && (
              <div className="bg-green-50 rounded-2xl p-4">
                <div className="text-sm text-gray-500 mb-2">预计摄入</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>热量 <span className="font-bold text-green-600">{estimated.calories.toFixed(0)}</span> kcal</div>
                  <div>蛋白质 <span className="font-bold">{estimated.protein_g.toFixed(0)}</span> g</div>
                  <div>脂肪 <span className="font-bold">{estimated.fat_g.toFixed(0)}</span> g</div>
                  <div>碳水 <span className="font-bold">{estimated.carbs_g.toFixed(0)}</span> g</div>
                </div>
              </div>
            )}

            <button onClick={save} className="w-full bg-green-600 text-white rounded-xl py-3 font-medium">
              确认记录
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
