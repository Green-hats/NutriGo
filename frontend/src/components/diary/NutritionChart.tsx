import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { goApi } from '../../api/go'
import { Loader2 } from 'lucide-react'

interface Props {
  onClose: () => void
}

export default function NutritionChart({ onClose }: Props) {
  const [data, setData] = useState<Array<{ date: string; kcal: number; protein: number; fat: number; carbs: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState(7)

  const load = useCallback((days: number) => {
    setLoading(true)
    setError('')
    const end = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    goApi.getSummaries(start, end).then((res) => {
      const mapped = res.items.map((r) => ({
        date: r.date.slice(5),
        kcal: Math.round(r.total_calories),
        protein: Math.round(r.total_protein_g),
        fat: Math.round(r.total_fat_g),
        carbs: Math.round(r.total_carbs_g),
      })).reverse()
      setData(mapped)
    }).catch(() => setError('趋势数据加载失败')).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(range) }, [range, load])

  return (
    <div className="absolute top-12 left-0 right-0 bottom-0 bg-white z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="font-semibold text-sm">营养趋势</span>
        <div className="flex items-center gap-2">
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setRange(d)}
              className={`text-xs px-2 py-1 rounded-full ${range === d ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
              {d}天
            </button>
          ))}
          <button onClick={onClose} className="ml-2 text-gray-400">✕</button>
        </div>
      </div>
      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm mb-3">{error}</p>
            <button onClick={() => load(range)} className="text-green-600 text-sm underline">重试</button>
          </div>
        ) : data.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">暂无数据，多记录几天饮食后再来看~</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data}>
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="kcal" name="热量(kcal)" fill="#16a34a" radius={[4,4,0,0]} />
              <Bar dataKey="protein" name="蛋白质(g)" fill="#3b82f6" radius={[4,4,0,0]} />
              <Bar dataKey="fat" name="脂肪(g)" fill="#f59e0b" radius={[4,4,0,0]} />
              <Bar dataKey="carbs" name="碳水(g)" fill="#8b5cf6" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
