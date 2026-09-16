import { ConnectionNotice } from '../ui/ConnectionNotice'
import { errorMessage } from '../../lib/connection'
import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlined from '@mui/icons-material/EditOutlined'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import { agentApi } from '../../api/agent'
import { toast } from '../../lib/toast'
import { ErrorBlock } from '../ui/ErrorBlock'
import { Skeleton } from '../ui/Skeleton'
import type { ChatMessage, SessionInfo } from '../../types'

export default function HistorySidebar({
  onSelect,
  onClose
}: {
  onSelect: (id: number, messages: ChatMessage[]) => void
  onClose: () => void
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{
    ids: number[]
    batch: boolean
  } | null>(null)
  const load = useCallback(() => {
    setLoading(true)
    setError('')
    agentApi
      .getSessions()
      .then((res) => setSessions(res.items.filter((x) => x.name)))
      .catch((err) => setError(errorMessage(err, '历史会话加载失败')))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])
  const loadSession = async (id: number) => {
    try {
      const detail = await agentApi.getSession(id)
      const msgs: ChatMessage[] = detail.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role:
            m.role === 'assistant' || m.role === 'user' || m.role === 'tool'
              ? m.role
              : 'assistant',
          content: m.content || '',
          toolName: m.tool_calls?.[0]?.function?.name
        }))
      onSelect(id, msgs)
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载会话失败')
    }
  }
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    try {
      const { ids, batch } = pendingDelete
      let count = 1
      if (batch) count = (await agentApi.batchDeleteSessions(ids)).deleted
      else await agentApi.deleteSession(ids[0])
      setSessions((prev) => prev.filter((s) => !ids.includes(s.id)))
      toast(`已删除 ${count} 个会话`, 'success')
      setSelected(new Set())
      setManageMode(false)
      setPendingDelete(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除会话失败')
    } finally {
      setDeleting(false)
    }
  }
  const saveRename = async (id: number) => {
    const name = editName.trim()
    if (!name) return
    try {
      await agentApi.renameSession(id, name)
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
      setEditingId(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : '重命名失败')
    }
  }
  return (
    <>
      <Drawer
        anchor="left"
        open
        onClose={deleting ? undefined : onClose}
        slotProps={{
          paper: {
            className: 'app-overlay',
            role: 'dialog',
            'aria-label': '历史会话',
            sx: {
              width: 'min(92vw, 400px)',
              height: 'var(--app-height, 100dvh)',
              bgcolor: '#F7F8F3',
              borderRadius: '0 24px 24px 0'
            }
          }
        }}
      >
        <ConnectionNotice />
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', p: 2.5 }}
        >
          <Box>
            <Typography variant="overline" color="primary">
              OUR CONVERSATIONS
            </Typography>
            <Typography variant="h2">历史会话</Typography>
          </Box>
          <IconButton
            onClick={onClose}
            disabled={deleting}
            aria-label="关闭历史会话"
          >
            <CloseRounded />
          </IconButton>
        </Stack>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            pb: 2
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {manageMode
              ? `已选 ${selected.size} 项`
              : '每一次对话，都有迹可循。'}
          </Typography>
          <Button
            size="small"
            aria-label={manageMode ? '退出批量管理' : '批量管理会话'}
            onClick={() => {
              setManageMode(!manageMode)
              setSelected(new Set())
              setEditingId(null)
            }}
          >
            {manageMode ? '完成' : '管理'}
          </Button>
        </Stack>
        {manageMode && (
          <Button
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineRounded />}
            disabled={selected.size === 0 || deleting}
            aria-label="删除所选会话"
            onClick={() =>
              setPendingDelete({ ids: [...selected], batch: true })
            }
            sx={{ mx: 2.5, mb: 2 }}
          >
            删除所选
          </Button>
        )}
        <Stack
          spacing={1.5}
          sx={{ overflowY: 'auto', minHeight: 0, px: 2.5, pb: 3 }}
        >
          {loading && (
            <>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </>
          )}
          {!loading && error && <ErrorBlock message={error} onRetry={load} />}
          {!loading && !error && sessions.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <ChatBubbleOutlineRounded
                sx={{ fontSize: 42, color: '#A3B79A', mb: 2 }}
              />
              <Typography color="text.secondary">暂无历史会话</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                聊聊今天吃了什么吧。
              </Typography>
            </Box>
          )}
          {!loading &&
            sessions.map((s) => (
              <Paper
                key={s.id}
                sx={{
                  px: 1,
                  py: 1.5,
                  border: '1px solid',
                  borderColor: selected.has(s.id) ? '#9CB894' : 'divider'
                }}
              >
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'center' }}
                >
                  {manageMode && (
                    <Checkbox
                      checked={selected.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      slotProps={{
                        input: { 'aria-label': `选择会话 ${s.name}` }
                      }}
                    />
                  )}
                  {editingId === s.id ? (
                    <TextField
                      autoFocus
                      size="small"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing)
                          saveRename(s.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      slotProps={{ htmlInput: { 'aria-label': '会话名称' } }}
                    />
                  ) : (
                    <ButtonBase
                      onClick={() =>
                        manageMode ? toggleSelect(s.id) : loadSession(s.id)
                      }
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        px: 1,
                        py: 0.5,
                        borderRadius: 2
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ fontWeight: 700 }}
                        >
                          {s.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontSize: 10 }}
                        >
                          {s.created_at}
                        </Typography>
                      </Box>
                    </ButtonBase>
                  )}
                  {!manageMode && (
                    <Stack direction="row">
                      {editingId === s.id ? (
                        <IconButton
                          aria-label="保存会话名称"
                          onClick={() => saveRename(s.id)}
                        >
                          <CheckRounded fontSize="small" />
                        </IconButton>
                      ) : (
                        <IconButton
                          aria-label="重命名"
                          onClick={() => {
                            setEditingId(s.id)
                            setEditName(s.name)
                          }}
                        >
                          <EditOutlined sx={{ fontSize: 17 }} />
                        </IconButton>
                      )}
                      <IconButton
                        aria-label="删除会话"
                        onClick={() =>
                          setPendingDelete({ ids: [s.id], batch: false })
                        }
                        sx={{ color: 'text.secondary' }}
                      >
                        <DeleteOutlineRounded sx={{ fontSize: 19 }} />
                      </IconButton>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            ))}
        </Stack>
      </Drawer>
      <Dialog
        open={pendingDelete !== null}
        onClose={deleting ? undefined : () => setPendingDelete(null)}
        aria-labelledby="delete-session-title"
      >
        <DialogTitle id="delete-session-title">删除会话？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定删除选中的 {pendingDelete?.ids.length ?? 0}{' '}
            个会话吗？删除后无法恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button disabled={deleting} onClick={() => setPendingDelete(null)}>
            保留会话
          </Button>
          <Button
            variant="contained"
            color="error"
            loading={deleting}
            onClick={confirmDelete}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
