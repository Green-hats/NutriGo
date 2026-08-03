import { useState, useEffect } from 'react'
import { MessageCircle, Trash2, X, Loader2 } from 'lucide-react'
import { agentApi } from '../../api/agent'
import type { ChatMessage } from '../../types'

interface Props {
  onSelect: (sessionId: number, messages: ChatMessage[]) => void
  onClose: () => void
}

export default function HistorySidebar({ onSelect, onClose }: Props) {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    agentApi.getSessions().then((s) => { setSessions(s.filter((x: any) => x.name)) }).finally(() => setLoading(false))
  }, [])

  const loadSession = async (id: number) => {
    try {
      const detail = await agentApi.getSession(id)
      const msgs: ChatMessage[] = detail.messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role,
          content: m.content || '',
          toolName: m.tool_calls?.[0]?.function?.name,
        }))
      onSelect(id, msgs)
    } catch {}
  }

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await agentApi.deleteSession(id)
    setSessions((s) => s.filter((x) => x.id !== id))
  }

  return (
    <div className="absolute top-12 left-0 right-0 bottom-0 bg-white z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="font-semibold text-sm">历史会话</span>
        <button onClick={onClose}><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>}
        {!loading && sessions.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">暂无历史会话</p>
        )}
        {sessions.map((s) => (
          <div key={s.id} onClick={() => loadSession(s.id)}
            className="flex items-center justify-between px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
            <div className="flex items-center gap-3 min-w-0">
              <MessageCircle size={16} className="text-green-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm truncate">{s.name}</p>
                <p className="text-xs text-gray-400">{s.created_at}</p>
              </div>
            </div>
            <button onClick={(e) => deleteSession(s.id, e)} className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
