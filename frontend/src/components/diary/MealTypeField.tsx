import { useId } from 'react'
import { Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { defaultMealType } from '../../lib/meal'

export function MealTypeField({ value, onChange, disabled = false }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const labelId = useId()
  return (
    <Stack spacing={1}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography id={labelId} sx={{ fontWeight: 650 }}>餐次</Typography>
        <Button size="small" disabled={disabled} onClick={() => onChange(defaultMealType())}
          sx={{ px: 1, minHeight: 44, fontSize: 12 }}>
          按当前时间选择
        </Button>
      </Stack>
      <ToggleButtonGroup exclusive fullWidth value={value} disabled={disabled}
        aria-labelledby={labelId} color="primary"
        onChange={(_, next: string | null) => { if (next) onChange(next) }}
        sx={{ '& .MuiToggleButton-root': { minWidth: 0, minHeight: 48, px: 0.5, fontSize: 14, fontWeight: 650 } }}>
        <ToggleButton value="breakfast">早餐</ToggleButton>
        <ToggleButton value="lunch">午餐</ToggleButton>
        <ToggleButton value="dinner">晚餐</ToggleButton>
        <ToggleButton value="snack">加餐</ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  )
}
