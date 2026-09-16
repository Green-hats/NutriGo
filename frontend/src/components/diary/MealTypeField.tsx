import { TextField } from '@mui/material'

export function MealTypeField({ value, onChange, disabled = false }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <TextField select fullWidth label="餐次" value={value} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} slotProps={{ select: { native: true } }}>
      <option value="breakfast">早餐</option>
      <option value="lunch">午餐</option>
      <option value="dinner">晚餐</option>
      <option value="snack">加餐</option>
    </TextField>
  )
}
