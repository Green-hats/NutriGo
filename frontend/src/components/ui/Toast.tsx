import { useState, useEffect, useRef } from 'react'
import { Alert, Box, Fade, Stack } from '@mui/material'
import { setToastHandler } from '../../lib/toast'

interface ToastData {
  id: number
  message: string
  type: 'error' | 'success'
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const idRef = useRef(0)
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    setToastHandler((message, type) => {
      const id = ++idRef.current
      setToasts((prev) => [...prev.slice(-2), { id, message, type }])
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        timers.delete(timer)
      }, 3500)
      timers.add(timer)
    })
    return () => {
      setToastHandler(null)
      timers.forEach(clearTimeout)
    }
  }, [])
  return (
    <Box
      className="app-toasts"
      sx={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 32px)',
        maxWidth: 420,
        zIndex: 1600,
        pointerEvents: 'none'
      }}
    >
      <Stack spacing={1}>
        {toasts.map((t) => (
          <Fade in key={t.id}>
            <Alert
              severity={t.type}
              onClose={() =>
                setToasts((prev) => prev.filter((item) => item.id !== t.id))
              }
              sx={{ pointerEvents: 'auto', boxShadow: '0 8px 32px #183F3020' }}
            >
              {t.message}
            </Alert>
          </Fade>
        ))}
      </Stack>
    </Box>
  )
}
