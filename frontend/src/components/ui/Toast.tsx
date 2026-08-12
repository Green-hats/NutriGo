import { useState, useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle, X } from 'lucide-react'
import { setToastHandler } from '../../lib/toast'

interface ToastData {
  id: number
  message: string
  type: 'error' | 'success'
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const idRef = useRef(0)

  // 模块级回调只在挂载后绑定，避免渲染期副作用（StrictMode 双渲染安全）
  useEffect(() => {
    setToastHandler((message, type) => {
      const newId = ++idRef.current
      setToasts((prev) => [...prev, { id: newId, message, type }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== newId)), 3500)
    })
    return () => setToastHandler(null)
  }, [])

  const dismiss = (tid: number) => setToasts((prev) => prev.filter((t) => t.id !== tid))

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90%] max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg animate-in slide-in-from-top-2 ${
            t.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'
          }`}
        >
          {t.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)}><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}
