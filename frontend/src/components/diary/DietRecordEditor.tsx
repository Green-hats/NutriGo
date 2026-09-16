import { useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { goApi } from '../../api/go'
import { errorMessage } from '../../lib/connection'
import { ConnectionNotice } from '../ui/ConnectionNotice'
import { MealTypeField } from './MealTypeField'
import { defaultMealType } from '../../lib/meal'
import type { DietRecord } from '../../types'

const nutrients = [
  ['calories', '热量（kcal）'], ['protein_g', '蛋白质（g）'],
  ['fat_g', '脂肪（g）'], ['carbs_g', '碳水（g）']
] as const

export default function DietRecordEditor({ date, record, onClose, onDone }: {
  date: string
  record?: DietRecord
  onClose: () => void
  onDone: () => void
}) {
  const [form, setForm] = useState({
    date: record?.date ?? date,
    meal_type: record?.meal_type || defaultMealType(),
    food_name: record?.food_name ?? '',
    portion: record?.portion ?? '',
    calories: record ? String(record.calories) : '',
    protein_g: record ? String(record.protein_g) : '',
    fat_g: record ? String(record.fat_g) : '',
    carbs_g: record ? String(record.carbs_g) : '',
    notes: record?.notes ?? ''
  })
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const update = (key: keyof typeof form, value: string) => setForm((old) => ({ ...old, [key]: value }))
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    if (!form.food_name.trim() || !form.date || nutrients.some(([key]) =>
      !form[key].trim() || !Number.isFinite(Number(form[key])) || Number(form[key]) < 0 || Number(form[key]) > 1000000)) {
      setError('请填写日期、食物名称和有效的非负营养数值。')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const data = { ...form, food_name: form.food_name.trim(),
        calories: Number(form.calories), protein_g: Number(form.protein_g),
        fat_g: Number(form.fat_g), carbs_g: Number(form.carbs_g),
        image_id: record?.image_id ?? null }
      if (record) await goApi.updateDietLog(record.id, data)
      else await goApi.createDietLog(data)
      onDone()
    } catch (err) {
      setError(errorMessage(err, '保存失败，请检查网络后重试'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  return (
    <Dialog fullScreen open onClose={saving ? undefined : onClose} aria-labelledby="diet-editor-title"
      slotProps={{ paper: { className: 'app-overlay' } }}>
      <ConnectionNotice />
      <DialogTitle id="diet-editor-title" component="div">
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h2">{record ? '编辑饮食记录' : '手动记录'}</Typography>
          <IconButton aria-label="关闭记录表单" disabled={saving} onClick={onClose}><CloseRounded /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ px: 3 }}>
        <Box component="form" onSubmit={save}>
          <Stack spacing={2.5} sx={{ pt: 1, pb: 3 }}>
            <TextField label="日期" type="date" required value={form.date} disabled={saving}
              onChange={(event) => update('date', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <MealTypeField value={form.meal_type} onChange={(value) => update('meal_type', value)} disabled={saving} />
            <TextField label="食物名称" required value={form.food_name} disabled={saving}
              onChange={(event) => update('food_name', event.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField label="食用份量" placeholder="例如 150g、1碗" value={form.portion} disabled={saving}
              onChange={(event) => update('portion', event.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
            <Typography variant="body2" color="text.secondary">填写本次食用总量的营养值，可参考食品标签；确实为零时填写 0。</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}>
              {nutrients.map(([key, label]) => (
                <TextField key={key} label={label} type="number" required value={form[key]} disabled={saving}
                  onChange={(event) => update(key, event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 1000000, step: 'any', inputMode: 'decimal' } }} />
              ))}
            </Box>
            <TextField label="备注" multiline minRows={2} value={form.notes} disabled={saving}
              onChange={(event) => update('notes', event.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" size="large" disabled={saving}>
              {saving ? '正在保存...' : record ? '保存修改' : '保存记录'}
            </Button>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
