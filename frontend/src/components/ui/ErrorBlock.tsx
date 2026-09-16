import { Alert, Button, Stack } from '@mui/material'
import RefreshRounded from '@mui/icons-material/RefreshRounded'

export function ErrorBlock({
  message,
  onRetry
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'center', py: 4, px: 2 }}>
      <Alert severity="error" sx={{ width: '100%' }}>
        {message}
      </Alert>
      {onRetry && (
        <Button
          variant="outlined"
          startIcon={<RefreshRounded />}
          onClick={onRetry}
        >
          重试
        </Button>
      )}
    </Stack>
  )
}
