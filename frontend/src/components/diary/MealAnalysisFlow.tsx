import { useEffect, useRef, useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button,
  CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper,
  Stack, TextField, Typography
} from '@mui/material'
import CameraAltRounded from '@mui/icons-material/CameraAltRounded'
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import { agentApi } from '../../api/agent'
import { goApi } from '../../api/go'
import { prepareFoodImage } from '../../lib/foodImage'
import { errorMessage } from '../../lib/connection'
import { defaultMealType } from '../../lib/meal'
import { isPreviewBuild } from '../../lib/preview'
import { ConnectionNotice } from '../ui/ConnectionNotice'
import { MealTypeField } from './MealTypeField'
import type { DietLogInput, MealAnalysis, MealEstimate, MealNutrients } from '../../types'

interface Draft extends MealEstimate {
  id: number
  edited: boolean
  gramsInput: string
  nutrientsInput: Record<keyof MealNutrients, string>
}

const nutrients = [
  ['calories', '热量', 'kcal'], ['protein_g', '蛋白质', 'g'],
  ['fat_g', '脂肪', 'g'], ['carbs_g', '碳水', 'g']
] as const
const mealNames: Record<string, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }
const round = (n: number) => Math.round(n * 10) / 10
const valid = (d: Draft) => d.name.trim().length > 0 && d.name.length <= 100 &&
  d.gramsInput.trim() !== '' && Number.isFinite(Number(d.gramsInput)) &&
  Number(d.gramsInput) >= 1 && Number(d.gramsInput) <= 3000 &&
  nutrients.every(([key]) => d.nutrientsInput[key].trim() !== '' &&
    Number.isFinite(Number(d.nutrientsInput[key])) && Number(d.nutrientsInput[key]) >= 0 &&
    Number(d.nutrientsInput[key]) <= (key === 'calories' ? 900 : 100)) &&
  ['protein_g', 'fat_g', 'carbs_g'].reduce((s, key) => s + Number(d.nutrientsInput[key as keyof MealNutrients]), 0) <= 105

function intake(d: Draft): MealNutrients {
  return Object.fromEntries(nutrients.map(([key]) =>
    [key, round(Number(d.nutrientsInput[key]) * Number(d.gramsInput) / 100)])) as unknown as MealNutrients
}

export default function MealAnalysisFlow({ date, onDone, onClose, onManual }: {
  date: string; onDone: () => void; onClose: () => void; onManual: (mealType: string) => void
}) {
  const [step, setStep] = useState<'camera' | 'analyzing' | 'review' | 'saving'>('camera')
  const [mealType, setMealType] = useState(defaultMealType)
  const [preview, setPreview] = useState('')
  const [imageId, setImageId] = useState(0)
  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null)
  const [items, setItems] = useState<Draft[]>([])
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const busy = useRef(false)
  const submission = useRef<{ id: string; records: DietLogInput[] } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const analyze = async (id: number) => {
    controller.current = new AbortController()
    const result = await agentApi.analyzeMeal(id, controller.current.signal)
    if (!mounted.current) return
    setAnalysis(result)
    setItems(result.items.map((item, i) => ({ ...item, id: i, edited: false,
      gramsInput: String(item.grams),
      nutrientsInput: Object.fromEntries(nutrients.map(([key]) => [key, String(item.nutrition_per_100g[key])])) as Draft['nutrientsInput']
    })))
    setStep('review')
  }

  const start = async (file?: File) => {
    if (busy.current) return
    busy.current = true
    setError('')
    if (file) setPreview(URL.createObjectURL(file))
    if (isPreviewBuild()) { busy.current = false; return }
    setStep('analyzing')
    try {
      let id = imageId
      if (file) {
        setImageId(0)
        const uploaded = await goApi.uploadImage(await prepareFoodImage(file))
        if (!mounted.current) return
        id = uploaded.id
        setImageId(id)
      }
      if (mounted.current) await analyze(id)
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err, '照片分析失败，请重试或手动记录。'))
        setStep('camera')
      }
    } finally { busy.current = false }
  }
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void start(file)
  }
  const patch = (id: number, update: Partial<Draft>) =>
    setItems(current => current.map(item => item.id === id ? { ...item, ...update } : item))
  const canSave = items.length > 0 && items.every(valid)
  const totals = items.filter(valid).reduce((sum, item) => {
    const values = intake(item)
    for (const [key] of nutrients) sum[key] = round(sum[key] + values[key])
    return sum
  }, { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 })

  const save = async () => {
    if (!canSave || busy.current) return
    busy.current = true
    setError('')
    try {
      // 一次提交只生成一个编号；超时重试仍使用同一份不可变数据。
      if (!submission.current) submission.current = {
        id: crypto.randomUUID(),
        records: items.map(item => ({ date, meal_type: mealType, food_name: item.name.trim(),
          portion: `${Number(item.gramsInput)}g`, ...intake(item), image_id: imageId,
          notes: `照片估算；营养来源：${item.edited ? '用户修正' : item.nutrition_source === 'database' ? '营养库' : 'AI 估算'}；模型：${analysis?.model}。原图估重 ${item.grams_low}–${item.grams_high}g。${item.assumption}`
        }))
      }
      setSubmitted(true)
      setStep('saving')
      await goApi.createDietBatch(submission.current.id, submission.current.records)
      if (mounted.current) onDone()
    } catch (err) {
      if (mounted.current) {
        setError(`${errorMessage(err, '保存失败')} 请重试确认保存结果；重试不会重复记录。`)
        setStep('review')
      }
    } finally { busy.current = false }
  }

  const saving = step === 'saving'
  return <Dialog fullScreen open onClose={saving ? undefined : onClose} aria-labelledby="food-flow-title"
    slotProps={{ paper: { className: 'app-overlay' } }}>
    <DialogTitle id="food-flow-title" component="div" sx={{ px: 3, pt: 2.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h2">{step === 'review' ? '确认这一餐' : '记录这一餐'}</Typography>
        <IconButton onClick={onClose} disabled={saving} aria-label="关闭"><CloseRounded /></IconButton>
      </Stack>
    </DialogTitle>
    <ConnectionNotice />
    <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 4 }}>
      <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto' }}>
        <Box><Typography variant="caption" color="text.secondary">{date}</Typography>
          <MealTypeField value={mealType} onChange={setMealType} disabled={submitted} /></Box>
        {error && <Alert severity="error">{error}</Alert>}
        {preview && <Box component="img" src={preview} alt="本次记录的食物照片"
          sx={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 4, bgcolor: '#EAF0E4' }} />}
        {step === 'camera' && <>
          {isPreviewBuild() && <Typography variant="caption" color="text.secondary">离线体验 · 仅本机预览</Typography>}
          {imageId > 0 && error && <Button variant="contained" onClick={() => void start()}>重试分析这张照片</Button>}
          <Button variant="contained" size="large" startIcon={<CameraAltRounded />} onClick={() => cameraRef.current?.click()}>拍照</Button>
          <Button variant="outlined" startIcon={<PhotoLibraryRounded />} onClick={() => fileRef.current?.click()}>从相册选择</Button>
          <input ref={fileRef} aria-label="选择食物照片" type="file" accept="image/*" hidden onChange={handleFile} />
          <input ref={cameraRef} aria-label="拍摄食物照片" type="file" accept="image/*" capture="environment" hidden onChange={handleFile} />
          <Button onClick={() => onManual(mealType)}>手动记录这一餐</Button>
        </>}
        {(step === 'analyzing' || saving) && <Stack spacing={2} sx={{ alignItems: 'center', py: 3 }}>
          <CircularProgress size={34} /><Typography variant="h3">{saving ? '正在保存...' : '正在识别...'}</Typography>
        </Stack>}
        {step === 'review' && <>
          {items.length === 0 && <Alert severity="warning">{analysis?.note || '未识别到食物，请重新拍照或手动记录。'}</Alert>}
          {items.map(item => <Paper key={item.id} component="section" aria-label={`食物 ${item.id + 1}`} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField label="食物名称" value={item.name} fullWidth disabled={submitted}
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                  onChange={e => patch(item.id, { name: e.target.value, edited: true })} />
                <IconButton aria-label={`移除${item.name}`} disabled={submitted} onClick={() => setItems(current => current.filter(i => i.id !== item.id))}><DeleteOutlineRounded /></IconButton>
              </Stack>
              <TextField label="份量（g）" type="number" value={item.gramsInput} disabled={submitted}
                error={!Number.isFinite(Number(item.gramsInput)) || Number(item.gramsInput) < 1 || Number(item.gramsInput) > 3000}
                slotProps={{ htmlInput: { min: 1, max: 3000, step: 'any', inputMode: 'decimal' } }}
                onChange={e => patch(item.id, { gramsInput: e.target.value })} />
              <Typography color="primary" sx={{ fontWeight: 700 }}>{valid(item) ? `预计 ${intake(item).calories} kcal` : '请检查克重和营养数值'}</Typography>
              <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ px: 0 }}>
                  <Typography variant="body2">营养详情 · {item.edited ? '用户修正' : item.nutrition_source === 'database' ? '营养库参考值' : 'AI 估算'}</Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <Typography variant="caption" color="text.secondary">估重范围 {item.grams_low}–{item.grams_high}g · {item.assumption}</Typography>
                  <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {nutrients.map(([key, label, unit]) => <TextField key={key} label={`${label} (${unit}/100g)`} type="number" value={item.nutrientsInput[key]} disabled={submitted}
                      slotProps={{ htmlInput: { min: 0, max: key === 'calories' ? 900 : 100, step: 'any', inputMode: 'decimal' } }}
                      onChange={e => patch(item.id, { edited: true, nutrientsInput: { ...item.nutrientsInput, [key]: e.target.value } })} />)}
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Paper>)}
          {canSave && <Paper sx={{ p: 2.5, bgcolor: '#EAF1E5' }}>
            <Typography variant="body2">本餐预计摄入 · {items.length} 项食物</Typography>
            <Typography sx={{ fontSize: 30, fontWeight: 750 }}>{totals.calories} <Typography component="span">kcal</Typography></Typography>
            <Typography variant="body2" color="text.secondary">蛋白质 {totals.protein_g}g · 脂肪 {totals.fat_g}g · 碳水 {totals.carbs_g}g</Typography>
          </Paper>}
          <Button disabled={!canSave} variant="contained" size="large" onClick={() => void save()}>{submitted ? '重试保存' : `确认记录 · ${mealNames[mealType]}`}</Button>
          {!submitted && <Stack direction="row" spacing={1}>
            <Button fullWidth onClick={() => { setError(''); setStep('camera') }}>重新拍照</Button>
            <Button fullWidth onClick={() => onManual(mealType)}>改为手动记录</Button>
          </Stack>}
        </>}
      </Stack>
    </DialogContent>
  </Dialog>
}
