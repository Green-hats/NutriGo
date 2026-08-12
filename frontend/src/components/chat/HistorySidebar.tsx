import { useState, useEffect, useRef } from 'react'
import { MessageCircle, Trash2, X, Loader2, Pencil } from 'lucide-react'
import { agentApi } from '../../api/agent'
import { toast } from '../../lib/toast'
import type { ChatMessage, SessionInfo } from '../../types'

interface Props {
  onSelect: (sessionId: number, messages: ChatMessage[]) => void
  onClose: () => void
}

export default function HistorySidebar({ onSelect, onClose }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 打开时把焦点移入面板，键盘用户可直接操作
  useEffect(() => { panelRef.current?.focus() }, [])

  useEffect(() => {
    agentApi.getSessions().then((res) => { setSessions(res.items.filter((x) => x.name)) }).finally(() => setLoading(false))
  }, [])

  const loadSession = async (id: number) => {
    try {
      const detail = await agentApi.getSession(id)
      const msgs: ChatMessage[] = detail.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' || m.role === 'user' || m.role === 'tool' ? m.role : 'assistant',
          content: m.content || '',
          toolName: m.tool_calls?.[0]?.function?.name,
        }))
      onSelect(id, msgs)
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载会话失败')
    }
  }

  const onRowClick = (id: number) => {
    if (manageMode) toggleSelect(id)
    else loadSession(id)
  }

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await agentApi.deleteSession(id)
    setSessions((s) => s.filter((x) => x.id !== id))
  }

  const batchDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`确定删除选中的 ${selected.size} 个会话吗？此操作不可撤销。`)) return
    setDeleting(true)
    try {
      const { deleted } = await agentApi.batchDeleteSessions([...selected])
      setSessions((s) => s.filter((x) => !selected.has(x.id)))
      toast(`已删除 ${deleted} 个会话`, 'success')
      setSelected(new Set())
      setManageMode(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : '批量删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const startRename = (id: number, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(id)
    setEditName(name)
  }

  const saveRename = async (id: number) => {
    const name = editName.trim()
    setEditingId(null)
    if (!name) return
    try {
      await agentApi.renameSession(id, name)
      setSessions((s) => s.map((x) => (x.id === id ? { ...x, name } : x)))
    } catch (err) {
      toast(err instanceof Error ? err.message : '重命名失败')
    }
  }

  return (
    <div ref={panelRef} tabIndex={-1} className="absolute top-12 left-0 right-0 bottom-0 bg-white z-40 flex flex-col outline-none">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        {manageMode ? (
          <>
            <span className="font-semibold text-sm">已选 {selected.size} 项</span>
            <div className="flex items-center gap-2">
              <button
                onClick={batchDelete}
                disabled={selected.size === 0 || deleting}
                aria-label="删除所选会话"
                className="flex items-center gap-1 text-xs text-white bg-red-500 rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                <Trash2 size={14} />{deleting ? '删除中...' : '删除所选'}
              </button>
              <button
                onClick={() => { setManageMode(false); setSelected(new Set()) }}
                aria-label="退出批量管理"
                className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="font-semibold text-sm">历史会话</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setManageMode(true)}
                aria-label="批量管理会话"
                className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                管理
              </button>
              <button onClick={onClose} aria-label="关闭历史会话"><X size={18} /></button>
            </div>
          </>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>}
        {!loading && sessions.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">暂无历史会话</p>
        )}
        {sessions.map((s) => (
          <div key={s.id} onClick={() => onRowClick(s.id)}
            className={`flex items-center justify-between px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${manageMode ? '' : 'cursor-pointer'}`}>
            <div className="flex items-center gap-3 min-w-0">
              {manageMode && (
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleSelect(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`选择会话 ${s.name}`}
                  className="w-4 h-4 accent-green-600 shrink-0"
                />
              )}
              <MessageCircle size={16} className="text-green-500 shrink-0" />
              <div className="min-w-0">
                {editingId === s.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => saveRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename(s.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full border border-green-500 rounded px-1.5 py-0.5 text-sm outline-none"
                  />
                ) : (
                  <p className="text-sm truncate">{s.name}</p>
                )}
                <p className="text-xs text-gray-400">{s.created_at}</p>
              </div>
            </div>
            {!manageMode && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={(e) => startRename(s.id, s.name, e)} aria-label="重命名" className="text-gray-300 hover:text-green-500"><Pencil size={14} /></button>
                <button onClick={(e) => deleteSession(s.id, e)} aria-label="删除会话" className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
