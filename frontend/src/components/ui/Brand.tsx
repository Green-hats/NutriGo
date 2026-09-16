import { Box, Stack, Typography } from '@mui/material'
import SpaRounded from '@mui/icons-material/SpaRounded'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box
        sx={{
          width: compact ? 34 : 42,
          height: compact ? 34 : 42,
          bgcolor: 'primary.main',
          color: 'white',
          borderRadius: '14px 14px 14px 5px',
          display: 'grid',
          placeItems: 'center'
        }}
      >
        <SpaRounded sx={{ fontSize: compact ? 21 : 25 }} />
      </Box>
      <Typography
        sx={{
          fontSize: compact ? 18 : 21,
          fontWeight: 800,
          letterSpacing: '-0.7px'
        }}
      >
        NutriGo<span style={{ color: '#AB5636' }}>.</span>
      </Typography>
    </Stack>
  )
}
