import type { ReactNode } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import SpaRounded from '@mui/icons-material/SpaRounded'
import CameraAltRounded from '@mui/icons-material/CameraAltRounded'
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded'
import { ConnectionNotice } from '../ui/ConnectionNotice'
import { Brand } from '../ui/Brand'

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <Box component="main" className="auth-screen" sx={{ px: 3 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
      >
        <Brand />
        <Typography variant="overline" color="text.secondary">
          EAT WELL. LIVE WELL.
        </Typography>
      </Stack>
      <ConnectionNotice />
      <Paper
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'primary.main',
          color: 'white',
          p: 3,
          mb: 3.5,
          borderRadius: '28px 28px 28px 8px'
        }}
      >
        <Typography variant="overline" sx={{ color: '#C2DAB9' }}>
          A LITTLE BETTER, EVERY DAY
        </Typography>
        <Typography variant="h2" sx={{ position: 'relative', mt: 1, mb: 1.25 }}>
          每一餐，
          <br />
          都是新的开始。
        </Typography>
        <Typography
          variant="body2"
          sx={{ position: 'relative', color: '#DAE7D7', maxWidth: '78%' }}
        >
          记录日常饮食，找到适合你的健康节奏。
        </Typography>
        <SpaRounded
          aria-hidden
          sx={{
            position: 'absolute',
            right: -18,
            bottom: -22,
            fontSize: 170,
            color: '#B4CF9F',
            opacity: 0.16,
            transform: 'rotate(-15deg)'
          }}
        />
      </Paper>
      <Stack
        direction="row"
        spacing={3}
        sx={{ mb: 3.5, color: 'text.secondary' }}
      >
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <CameraAltRounded sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="body2">拍照记录</Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <AutoAwesomeRounded sx={{ fontSize: 18, color: 'secondary.main' }} />
          <Typography variant="body2">AI 营养陪伴</Typography>
        </Stack>
      </Stack>
      <Box sx={{ mb: 2.5 }}>
        <Typography component="h1" variant="h2">
          {title}
        </Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
          {subtitle}
        </Typography>
      </Box>
      {children}
      <Typography
        component="div"
        variant="body2"
        color="text.secondary"
        sx={{ textAlign: 'center', mt: 3, pb: 2 }}
      >
        {footer}
      </Typography>
    </Box>
  )
}
