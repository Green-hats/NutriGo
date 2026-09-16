import type { ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  action
}: {
  title: string
  subtitle?: string
  eyebrow?: string
  action?: ReactNode
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 3,
        pt: 3,
        pb: 2.5
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && (
          <Typography variant="overline" color="primary">
            {eyebrow}
          </Typography>
        )}
        <Typography component="h1" variant="h2">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  )
}
