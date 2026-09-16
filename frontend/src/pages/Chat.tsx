import { isPreviewBuild } from '../lib/preview'
import { ConnectionError, isOffline } from '../lib/connection'
import { useState, useRef, useEffect } from 'react'
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import HistoryRounded from '@mui/icons-material/HistoryRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import StopRounded from '@mui/icons-material/StopRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import ArrowOutwardRounded from '@mui/icons-material/ArrowOutwardRounded'
import SpaRounded from '@mui/icons-material/SpaRounded'
import RestaurantRounded from '@mui/icons-material/RestaurantRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore } from '../stores/chat'
import { useAuthStore } from '../stores/auth'
import { createChatStream } from '../api/sse'
import type { ChatStreamHandle } from '../api/sse'
import { ChatErrorBoundary } from '../components/ui/ChatErrorBoundary'
import { Brand } from '../components/ui/Brand'
import HistorySidebar from '../components/chat/HistorySidebar'
import ToolResultCard from '../components/chat/ToolResultCard'
import type { ChatMessage } from '../types'

const QUICK_CHIPS = [
  {
    title: '回顾今天的饮食',
    text: '分析我今天吃什么',
    note: '发现每一餐的小进步',
    icon: SpaRounded
  },
  {
    title: '下一餐吃什么',
    text: '推荐午餐',
    note: '给日常一点新灵感',
    icon: RestaurantRounded
  },
  {
    title: '了解食物热量',
    text: '这个有多少热量',
    note: '吃得明白，也吃得开心',
    icon: AutoAwesomeRounded
  },
  {
    title: '了解我的 BMI',
    text: '帮我算BMI',
    note: '从认识自己开始',
    icon: SpaRounded
  }
]

export default function Chat() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<ChatStreamHandle | null>(null)
  const failedMessageRef = useRef<string | null>(null)
  const acceptedRef = useRef(false)
  const {
    messages,
    addMessage,
    appendToLast,
    appendThinkingToLast,
    updateToolResult,
    setMessages,
    setSessionId,
    sessionId,
    isStreaming,
    setStreaming,
    clearMessages,
    truncateToLastUser
  } = useChatStore()
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (messages.length > 0)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  useEffect(
    () => () => {
      streamRef.current?.cancel()
      useChatStore.getState().setStreaming(false)
    },
    []
  )

  const newChat = () => {
    if (!isStreaming) {
      clearMessages()
      failedMessageRef.current = null
      acceptedRef.current = false
      setError('')
    }
  }

  const send = (text: string) => {
    const msg = text.trim()
    if (!msg || isStreaming) return
    failedMessageRef.current = msg
    acceptedRef.current = false
    if (isOffline() && !isPreviewBuild()) {
      setError(new ConnectionError('offline').message)
      setInput(msg)
      return
    }
    const previousMessages = messages
    setInput('')
    setError('')
    addMessage({ role: 'user', content: msg })
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)

    const handle = createChatStream(
      sessionId,
      token,
      {
        onSessionId: (id) => {
          acceptedRef.current = true
          setSessionId(id)
        },
        onChunk: (t) => appendToLast(t),
        onThinking: (t) => appendThinkingToLast(t),
        onToolCall: (name) =>
          addMessage({ role: 'tool', content: '', toolName: name }),
        onToolResult: (name, result) => updateToolResult(name, result),
        onDone: () => {
          setStreaming(false)
          streamRef.current = null
        },
        onError: (err) => {
          if (!acceptedRef.current) {
            setMessages(previousMessages)
            setInput((draft) => draft || msg)
          }
          setError(err)
          setStreaming(false)
          streamRef.current = null
        }
      },
      msg
    )
    streamRef.current = handle
  }

  const retry = () => {
    if (isStreaming) return
    if (!acceptedRef.current && failedMessageRef.current) {
      send(failedMessageRef.current)
      return
    }
    // 后端确认接收后，回滚并重新生成，避免重复添加同一条用户消息。
    if (!sessionId) return
    setError('')
    truncateToLastUser()
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)

    const handle = createChatStream(
      sessionId,
      token,
      {
        onSessionId: (id) => setSessionId(id),
        onChunk: (t) => appendToLast(t),
        onThinking: (t) => appendThinkingToLast(t),
        onToolCall: (name) =>
          addMessage({ role: 'tool', content: '', toolName: name }),
        onToolResult: (name, result) => updateToolResult(name, result),
        onDone: () => {
          setStreaming(false)
          streamRef.current = null
        },
        onError: (err) => {
          setError(err)
          setStreaming(false)
          streamRef.current = null
        }
      },
      undefined,
      'regenerate'
    )
    streamRef.current = handle
  }

  const stop = () => {
    streamRef.current?.cancel()
    streamRef.current = null
    setStreaming(false)
  }

  const regenerate = () => {
    if (!sessionId || isStreaming) return
    acceptedRef.current = true
    failedMessageRef.current = null
    setError('')
    // 前端先回滚到最后一条 user（与后端 rollback 保持一致），再补一个空 assistant 让流式填充
    truncateToLastUser()
    addMessage({ role: 'assistant', content: '' })
    setStreaming(true)

    const handle = createChatStream(
      sessionId,
      token,
      {
        onSessionId: (id) => setSessionId(id),
        onChunk: (t) => appendToLast(t),
        onThinking: (t) => appendThinkingToLast(t),
        onToolCall: (name) =>
          addMessage({ role: 'tool', content: '', toolName: name }),
        onToolResult: (name, result) => updateToolResult(name, result),
        onDone: () => {
          setStreaming(false)
          streamRef.current = null
        },
        onError: (err) => {
          setError(err)
          setStreaming(false)
          streamRef.current = null
        }
      },
      undefined,
      'regenerate'
    )
    streamRef.current = handle
  }

  const handleHistorySelect = (id: number, msgs: ChatMessage[]) => {
    setMessages(msgs)
    setSessionId(id)
    setShowHistory(false)
    setError('')
    failedMessageRef.current = null
    acceptedRef.current = false
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0
      }}
    >
      <Stack
        component="header"
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0
        }}
      >
        <Box>
          <Brand compact />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            你的 AI 营养师
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.5}>
          <IconButton
            onClick={() => setShowHistory(true)}
            disabled={isStreaming}
            aria-label="历史会话"
          >
            <HistoryRounded />
          </IconButton>
          <IconButton
            onClick={newChat}
            disabled={isStreaming}
            aria-label="新建会话"
            title="新建会话"
            sx={{ bgcolor: '#E8F0E1', color: 'primary.main' }}
          >
            <AddRounded />
          </IconButton>
        </Stack>
      </Stack>
      {showHistory && (
        <HistorySidebar
          onSelect={handleHistorySelect}
          onClose={() => setShowHistory(false)}
        />
      )}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2 }}>
        <ChatErrorBoundary>
          {messages.length === 0 && (
            <Box sx={{ pt: { xs: 0, sm: 4 } }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.75,
                  bgcolor: '#EAF0E2',
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 2,
                  mb: 2
                }}
              >
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: '#52844C'
                  }}
                />
                <Typography
                  variant="overline"
                  sx={{ fontSize: 9, color: 'primary.main' }}
                >
                  SMALL STEPS. HEALTHY DAYS.
                </Typography>
              </Box>
              <Typography
                component="h1"
                variant="h1"
                sx={{ fontSize: { xs: 30, sm: 38 } }}
              >
                吃好每一餐，
                <br />
                从聊聊开始。
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1, mb: 2, maxWidth: 300 }}
              >
                关于吃什么、怎么吃，
                <br />
                或是今天的小小困惑，都可以告诉我。
              </Typography>
              <Paper
                sx={{
                  bgcolor: '#EAF0E2',
                  p: 2,
                  mb: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  overflow: 'hidden'
                }}
              >
                <Box
                  sx={{
                    bgcolor: '#DCE8D0',
                    border: '6px solid #F6F8EE',
                    outline: '1px solid #D1DFC6',
                    width: 56,
                    height: 56,
                    flexShrink: 0,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'primary.main',
                    transform: 'rotate(-12deg)'
                  }}
                >
                  <SpaRounded sx={{ fontSize: 31 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>
                    健康，不必一步到位
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    认真对待每一餐，就是好的开始。
                  </Typography>
                </Box>
              </Paper>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: 'block', mb: 1.5 }}
              >
                从这里聊起
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 1.25
                }}
              >
                {QUICK_CHIPS.map(({ title, text, note, icon: Icon }) => (
                  <Button
                    key={text}
                    onClick={() => send(text)}
                    variant="outlined"
                    sx={{
                      alignItems: 'flex-start',
                      flexDirection: 'column',
                      textAlign: 'left',
                      p: 1.5,
                      borderRadius: 4,
                      bgcolor: 'white',
                      borderColor: 'divider',
                      minWidth: 0
                    }}
                  >
                    <Stack
                      direction="row"
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        width: '100%',
                        mb: 1
                      }}
                    >
                      <Icon sx={{ fontSize: 21, color: 'primary.main' }} />
                      <ArrowOutwardRounded
                        sx={{ fontSize: 15, color: '#97A48E' }}
                      />
                    </Stack>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {title}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontSize: 10, mt: 0.5 }}
                    >
                      {note}
                    </Typography>
                  </Button>
                ))}
              </Box>
            </Box>
          )}
          <Stack spacing={3}>
            {messages.map((msg, i) => (
              <Box key={msg.id ?? i}>
                {msg.role === 'user' && (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Paper
                      sx={{
                        px: 2,
                        py: 1.5,
                        bgcolor: '#E1EBD8',
                        borderRadius: '18px 18px 5px 18px',
                        maxWidth: '88%',
                        overflowWrap: 'anywhere'
                      }}
                    >
                      <Typography
                        variant="body1"
                        sx={{ whiteSpace: 'pre-wrap', fontSize: 14 }}
                      >
                        {msg.content}
                      </Typography>
                    </Paper>
                  </Box>
                )}
                {msg.role === 'assistant' && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: 'primary.main',
                        mt: 0.5
                      }}
                    >
                      <SpaRounded sx={{ fontSize: 17 }} />
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Paper
                        className="markdown-body"
                        sx={{
                          px: 2,
                          py: 1.75,
                          borderRadius: '5px 18px 18px 18px',
                          border: '1px solid',
                          borderColor: 'divider'
                        }}
                        aria-live={
                          isStreaming && i === messages.length - 1
                            ? 'polite'
                            : undefined
                        }
                      >
                        {msg.thinking && (
                          <Box
                            component="details"
                            sx={{
                              fontSize: 12,
                              color: 'text.secondary',
                              mb: 1.5
                            }}
                          >
                            <Box
                              component="summary"
                              sx={{ cursor: 'pointer', py: 0.5 }}
                            >
                              分析过程
                            </Box>
                            <Typography
                              variant="body2"
                              sx={{ whiteSpace: 'pre-wrap', mt: 1 }}
                            >
                              {msg.thinking}
                            </Typography>
                          </Box>
                        )}
                        {msg.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content +
                              (isStreaming && i === messages.length - 1
                                ? '▍'
                                : '')}
                          </ReactMarkdown>
                        ) : (
                          isStreaming &&
                          i === messages.length - 1 && (
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <CircularProgress size={14} />
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                正在认真想一想...
                              </Typography>
                            </Stack>
                          )
                        )}
                      </Paper>
                      {msg.content &&
                        !isStreaming &&
                        i === messages.length - 1 &&
                        sessionId && (
                          <Button
                            onClick={regenerate}
                            title="重新生成"
                            aria-label="重新生成"
                            size="small"
                            startIcon={<RefreshRounded />}
                            sx={{
                              mt: 0.5,
                              minHeight: 40,
                              fontSize: 11,
                              color: 'text.secondary'
                            }}
                          >
                            重新生成
                          </Button>
                        )}
                    </Box>
                  </Stack>
                )}
                {msg.role === 'tool' && (
                  <ToolResultCard message={msg} isStreaming={isStreaming} />
                )}
              </Box>
            ))}
          </Stack>
          {error && (
            <Paper
              sx={{ p: 2, mt: 2, bgcolor: '#FFF0EB', color: 'error.main' }}
              role="alert"
            >
              <Typography variant="body2">{error}</Typography>
              <Stack direction="row" spacing={1}>
                {(sessionId || failedMessageRef.current) && (
                  <Button size="small" onClick={retry} color="error">
                    重试
                  </Button>
                )}
                <Button size="small" onClick={() => setError('')} color="error">
                  关闭
                </Button>
              </Stack>
            </Paper>
          )}
          <div ref={bottomRef} />
        </ChatErrorBoundary>
      </Box>
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          flexShrink: 0,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: '#F7F8F3'
        }}
      >
        <Paper
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 1,
            pl: 1.5,
            pr: 1,
            py: 0.75,
            border: '1px solid #DDE5D6',
            borderRadius: 4
          }}
        >
          <TextField
            multiline
            maxRows={4}
            placeholder="输入消息..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                send(input)
              }
            }}
            slotProps={{
              htmlInput: { maxLength: 2000, 'aria-label': '消息内容' }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                background: 'transparent',
                p: 0,
                minHeight: 44,
                borderRadius: 0
              },
              '& .MuiOutlinedInput-notchedOutline': { border: 0 },
              '& textarea': { py: '10px', px: 0, lineHeight: 1.5 }
            }}
          />
          {isStreaming ? (
            <IconButton
              onClick={stop}
              title="停止生成"
              aria-label="停止生成"
              sx={{ bgcolor: '#F4E4DD', color: 'error.main', borderRadius: 3 }}
            >
              <StopRounded />
            </IconButton>
          ) : (
            <IconButton
              onClick={() => send(input)}
              disabled={!input.trim()}
              aria-label="发送"
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                borderRadius: 3,
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: '#E5EBDE', color: '#889A7D' }
              }}
            >
              <ArrowUpwardRounded />
            </IconButton>
          )}
        </Paper>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textAlign: 'center', display: 'block', fontSize: 10, mt: 0.75 }}
        >
          AI 建议仅供日常饮食参考
        </Typography>
      </Box>
    </Box>
  )
}
