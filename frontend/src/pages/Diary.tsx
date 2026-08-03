import { useState, useRef, useEffect, useCallback } from 'react'
import { goApi } from '../api/go'
import { agentApi } from '../api/agent'
import { Plus, Camera, Trash2, ChevronLeft, ChevronRight, Loader2, Check } from 'lucide-react'
import { toast } from '../components/ui/Toast'
import { ErrorBlock } from '../components/ui/ErrorBlock'
import { Skeleton } from '../components/ui/Skeleton'
import type { DietRecord, IdentifyResult } from '../types'

function todayStr(): string { return new Date().toISOString().slice(0, 10) }
function fmt(d: Date): string { return d.toISOString().slice(0, 10) }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r }

export default function Diary() {
  const [date, setDate] = useState(new Date())
  const [records, setRecords] = useState<DietRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showFlow, setShowFlow] = useState(false)

  const loadRecords = useCallback(() => {
    setLoading(true)
    setError('')
    goApi.getDietLogs(fmt(date)).then(setRecords).catch(() => setError('加载失败')).finally(() => setLoading(false))
  }, [date])
  useEffect(loadRecords, [loadRecords])

  const del = async (id: number) => {
    try { await goApi.deleteDietLog(id); loadRecords() } catch (err: any) { toast(err.message) }
  }

  const totalCal = records.reduce((s, r) => s + (r.calories || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-green-600 text-white py-4 px-6 text-center text-lg font-semibold">饮食日记</div>
      <div className="bg-white px-4 py-3 flex items-center justify-between border-b">
        <button onClick={() => setDate(addDays(date, -1))}><ChevronLeft /></button>
        <span className="font-medium">{fmt(date)}</span>
        <button onClick={() => setDate(addDays(date, 1))}><ChevronRight /></button>
      </div>

      <div className="bg-white mx-4 mt-3 rounded-2xl p-4 shadow-sm">
        <div className="text-xs text-gray-400 mb-1">今日摄入</div>
        <div className="text-3xl font-bold text-green-600">{loading ? '...' : totalCal.toFixed(0)} <span className="text-base font-normal text-gray-400">kcal</span></div>
      </div>

      <div className="p-4 space-y-3 pb-20">
        {loading && [1,2].map(i => <Skeleton key={i} className="h-20" />)}
        {!loading && error && <ErrorBlock message={error} onRetry={loadRecords} />}
        {!loading && !error && records.length === 0 && (
          <div className="flex flex-col items-center mt-10 text-gray-400">
            <p className="text-4xl mb-3">🍽️</p>
            <p className="mb-4">今天还没有记录</p>
            <button onClick={() => setShowFlow(true)} className="bg-green-600 text-white rounded-full px-6 py-2 text-sm">📷 拍照记录</button>
          </div>
        )}
        {!loading && !error && records.map((r) => (
          <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm flex justify-between items-center">
            <div>
              <div className="font-medium">{r.food_name}</div>
              <div className="text-xs text-gray-400 mt-1">{r.portion} · {r.calories?.toFixed(0)}kcal · 蛋白质{r.protein_g?.toFixed(0)}g</div>
            </div>
            <button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={18} /></button>
          </div>
        ))}
      </div>

      <button onClick={() => setShowFlow(true)} className="fixed bottom-20 right-6 bg-green-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:bg-green-700 transition-colors z-40"><Plus size={28} /></button>

      {showFlow && <FoodFlow date={fmt(date)} onDone={() => { loadRecords(); setShowFlow(false) }} onClose={() => setShowFlow(false)} />}
    </div>
  )
}

// ====== 拍照识别流程 ======
const STEPS = ['📷', '🔍', '📋', '⚖️', '✅']
const STEP_LABELS = ['拍照', '识别', '选择', '份量', '保存']

function FoodFlow({ date, onDone, onClose }: { date: string; onDone: () => void; onClose: () => void }) {
  const [step, setStep] = useState<'camera' | 'identifying' | 'candidates' | 'portion' | 'saving'>('camera')
  const stepIdx = ['camera', 'identifying', 'candidates', 'portion', 'saving'].indexOf(step)
  const [imageId, setImageId] = useState(0)
  const [candidates, setCandidates] = useState<IdentifyResult[]>([])
  const [selected, setSelected] = useState<IdentifyResult | null>(null)
  const [grams, setGrams] = useState(300)
  const [estimated, setEstimated] = useState<any>(null)
  const [estimating, setEstimating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setStep('identifying')
    try {
      const img = await goApi.uploadImage(file)
      setImageId(img.id)
      const results = await agentApi.identifyFood(img.id)
      if (results.length === 0) {
        toast('未识别到食物，请重新拍照')
        setStep('camera')
        return
      }
      setCandidates(results)
      setStep('candidates')
    } catch (err: any) {
      toast('识别失败: ' + err.message)
      setStep('camera')
    }
  }

  const selectCandidate = (c: IdentifyResult) => {
    setSelected(c)
    setGrams(c.default_portion.grams)
    setStep('portion')
    updateEstimate(c.name, c.default_portion.grams)
  }

  const updateEstimate = (foodName: string, g: number) => {
    if (g <= 0) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setEstimating(true)
      try {
        const r = await agentApi.calculateIntake(foodName, g)
        setEstimated(r)
      } catch { toast('计算失败') }
      finally { setEstimating(false) }
    }, 500)
  }

  const save = async () => {
    if (!selected || !estimated) return
    setStep('saving')
    try {
      await goApi.createDietLog({
        date, meal_type: 'snack', food_name: selected.name, portion: `${grams}g`,
        calories: estimated.calories, protein_g: estimated.protein_g, fat_g: estimated.fat_g, carbs_g: estimated.carbs_g, image_id: imageId,
      })
      onDone()
    } catch (err: any) {
      toast('保存失败: ' + err.message)
      setStep('portion')
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      <div className="bg-green-600 text-white py-4 px-6 flex justify-between items-center">
        <span className="font-semibold">{STEP_LABELS[stepIdx]}</span>
        <button onClick={onClose} className="text-white">✕</button>
      </div>
      {/* 步骤条 */}
      <div className="flex items-center justify-center gap-2 px-6 py-3 bg-green-50">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${i <= stepIdx ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
              {i < stepIdx ? <Check size={14} /> : s}
            </div>
            {i < 4 && <div className={`w-6 h-0.5 ${i < stepIdx ? 'bg-green-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {step === 'camera' && (
          <div className="flex flex-col items-center gap-6 mt-16">
            <Camera size={64} className="text-green-600" />
            <p className="text-gray-500">拍一张你的食物照片</p>
            <button onClick={() => fileRef.current?.click()} className="bg-green-600 text-white rounded-xl px-8 py-3 font-medium">📷 拍照 / 从相册选择</button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
          </div>
        )}

        {step === 'identifying' && (
          <div className="flex flex-col items-center gap-4 mt-20">
            <Loader2 size={48} className="animate-spin text-green-600" />
            <p className="text-gray-500">AI 正在识别你的食物...</p>
            <p className="text-xs text-gray-300">510 道家常菜中匹配，约需 20 秒</p>
          </div>
        )}

        {step === 'candidates' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400 mb-2">识别结果，请选择一个：</p>
            {candidates.map((c) => (
              <button key={c.name} onClick={() => selectCandidate(c)}
                className="w-full bg-white border border-gray-200 rounded-2xl p-4 text-left hover:border-green-500 transition-colors">
                <div className="flex justify-between items-center"><span className="font-medium">{c.name}</span><span className="text-sm text-green-600">{(c.confidence * 100).toFixed(1)}%</span></div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-green-500 rounded-full" style={{ width: `${c.confidence * 100}%` }} /></div>
                <div className="text-xs text-gray-400 mt-1">每100g: {c.nutrition_per_100g.calories}kcal · 默认{c.default_portion.grams}g/{c.default_portion.unit}</div>
              </button>
            ))}
            <button onClick={() => setStep('camera')} className="w-full text-gray-400 text-sm py-2">↩ 重新拍照</button>
          </div>
        )}

        {step === 'portion' && selected && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="text-2xl font-bold">{selected.name}</div>
              <div className="text-sm text-gray-400 mt-1">每100g: {selected.nutrition_per_100g.calories}kcal · P{selected.nutrition_per_100g.protein_g}g</div>
            </div>
            <div className="bg-gray-50 rounded-2xl p-6">
              <label className="text-sm text-gray-400">吃了多少克？</label>
              <div className="flex items-center gap-4 mt-2">
                <button onClick={() => { setGrams(Math.max(10, grams - 50)); updateEstimate(selected.name, Math.max(10, grams - 50)) }} className="bg-white border rounded-xl w-10 h-10 flex items-center justify-center text-lg">−</button>
                <input type="number" className="flex-1 text-center text-3xl font-bold bg-transparent outline-none"
                  value={grams} onChange={(e) => { const g = parseInt(e.target.value) || 0; setGrams(g); updateEstimate(selected.name, g) }} />
                <button onClick={() => { const g = grams + 50; setGrams(g); updateEstimate(selected.name, g) }} className="bg-white border rounded-xl w-10 h-10 flex items-center justify-center text-lg">+</button>
              </div>
              <div className="text-center text-gray-400 text-sm mt-1">克</div>
            </div>
            {estimating && <Skeleton className="h-24" />}
            {!estimating && estimated && (
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
            <button onClick={save} className="w-full bg-green-600 text-white rounded-xl py-3 font-medium">确认记录</button>
          </div>
        )}

        {step === 'saving' && (
          <div className="flex flex-col items-center gap-6 mt-20">
            <Loader2 size={48} className="animate-spin text-green-600" />
            <p className="text-gray-500">正在保存...</p>
            {selected && (
              <div className="bg-gray-50 rounded-2xl p-4 w-full">
                <p className="font-medium">{selected.name} {grams}g</p>
                {estimated && <p className="text-sm text-gray-400 mt-1">{estimated.calories?.toFixed(0)}kcal</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
