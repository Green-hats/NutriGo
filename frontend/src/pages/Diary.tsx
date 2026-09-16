import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import {
  Box,
  Button,
  CardActionArea,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography
} from '@mui/material'
import CameraAltRounded from '@mui/icons-material/CameraAltRounded'
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import BarChartRounded from '@mui/icons-material/BarChartRounded'
import RestaurantRounded from '@mui/icons-material/RestaurantRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import RemoveRounded from '@mui/icons-material/RemoveRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import SpaRounded from '@mui/icons-material/SpaRounded'
import { goApi } from '../api/go'
import { agentApi } from '../api/agent'
import { toast } from '../lib/toast'
import { prepareFoodImage } from '../lib/foodImage'
import { ErrorBlock } from '../components/ui/ErrorBlock'
import { Skeleton } from '../components/ui/Skeleton'
import { PageHeader } from '../components/layout/PageHeader'
import type { DietRecord, IdentifyResult, IntakeResult } from '../types'

const NutritionChart = lazy(() => import('../components/diary/NutritionChart'))
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
const mealNames: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

export default function Diary() {
  const [date, setDate] = useState(new Date())
  const [records, setRecords] = useState<DietRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showFlow, setShowFlow] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const loadRecords = useCallback(() => {
    setLoading(true)
    setError('')
    goApi
      .getDietLogs(fmt(date))
      .then(setRecords)
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false))
  }, [date])
  useEffect(loadRecords, [loadRecords])
  const del = async (id: number) => {
    try {
      await goApi.deleteDietLog(id)
      loadRecords()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败')
    }
  }
  const total = records.reduce(
    (s, r) => ({
      calories: s.calories + (r.calories || 0),
      protein: s.protein + (r.protein_g || 0),
      carbs: s.carbs + (r.carbs_g || 0),
      fat: s.fat + (r.fat_g || 0)
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )
  const today = fmt(date) === fmt(new Date())
  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        eyebrow="YOUR DAILY NOURISHMENT"
        title="饮食日记"
        subtitle="好好吃饭，也是好好爱自己。"
        action={
          <IconButton
            aria-label="查看营养趋势"
            onClick={() => setShowChart(true)}
            sx={{
              bgcolor: 'white',
              border: '1px solid',
              borderColor: 'divider'
            }}
          >
            <BarChartRounded />
          </IconButton>
        }
      />
      <Stack spacing={2.5} sx={{ px: 3 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <IconButton
            onClick={() => setDate(addDays(date, -1))}
            aria-label="前一天"
          >
            <ChevronLeftRounded />
          </IconButton>
          <Stack sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {today
                ? '今天'
                : date.toLocaleDateString('zh-CN', { weekday: 'long' })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {fmt(date)}
            </Typography>
          </Stack>
          <IconButton
            onClick={() => setDate(addDays(date, 1))}
            aria-label="后一天"
          >
            <ChevronRightRounded />
          </IconButton>
        </Stack>
        <Paper
          sx={{
            bgcolor: 'primary.main',
            color: 'white',
            p: 3,
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '26px 26px 26px 8px'
          }}
        >
          <SpaRounded
            aria-hidden
            sx={{
              position: 'absolute',
              right: -25,
              top: 10,
              fontSize: 170,
              color: '#B8CEAB',
              opacity: 0.13,
              transform: 'rotate(-18deg)'
            }}
          />
          <Typography variant="body2" sx={{ color: '#D2E3CD' }}>
            {today ? '今日摄入' : '当日摄入'}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'baseline', mt: 0.5 }}
          >
            <Typography
              sx={{
                fontSize: 48,
                fontWeight: 650,
                lineHeight: 1.3,
                letterSpacing: '-2px',
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {loading ? '—' : error ? '—' : total.calories.toFixed(0)}
            </Typography>
            <Typography sx={{ color: '#CBDFC5', fontSize: 14 }}>
              kcal
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            sx={{ color: '#C1D7BA', display: 'block', mt: 1 }}
          >
            {loading
              ? '正在整理你的饮食记录'
              : error
                ? '暂时无法获取摄入数据'
                : records.length
                  ? `来自 ${records.length} 条饮食记录`
                  : '从记录第一餐开始积累'}
          </Typography>
        </Paper>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1
          }}
        >
          {[
            {
              label: '蛋白质',
              value: total.protein,
              color: '#215743',
              bg: '#EAF1E7'
            },
            {
              label: '碳水',
              value: total.carbs,
              color: '#9B592E',
              bg: '#FAEEE0'
            },
            { label: '脂肪', value: total.fat, color: '#68608F', bg: '#EFEDF5' }
          ].map((item) => (
            <Paper
              key={item.label}
              sx={{ p: 1.5, bgcolor: item.bg, borderRadius: 3 }}
            >
              <Typography variant="caption" sx={{ color: item.color }}>
                {item.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: 21,
                  fontWeight: 750,
                  mt: 0.5,
                  color: item.color
                }}
              >
                {loading || error ? '—' : item.value.toFixed(0)}{' '}
                <Typography component="span" variant="caption">
                  g
                </Typography>
              </Typography>
            </Paper>
          ))}
        </Box>
        <Button
          aria-label="添加记录"
          variant="contained"
          onClick={() => setShowFlow(true)}
          startIcon={<CameraAltRounded />}
          endIcon={<AddRounded />}
          sx={{
            minHeight: 52,
            bgcolor: '#E5EEDE',
            color: 'primary.dark',
            '&:hover': { bgcolor: '#DCE8D4' }
          }}
        >
          记录这一餐
        </Button>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            pt: 0.5
          }}
        >
          <Typography variant="h3">这一日的餐桌</Typography>
          <Typography variant="caption" color="text.secondary">
            {loading ? '加载中' : `${records.length} 条记录`}
          </Typography>
        </Stack>
        {loading && (
          <Stack spacing={1.5}>
            <Skeleton />
            <Skeleton />
          </Stack>
        )}
        {!loading && error && (
          <ErrorBlock message={error} onRetry={loadRecords} />
        )}
        {!loading && !error && records.length === 0 && (
          <Paper
            sx={{ p: 3, textAlign: 'center', border: '1px dashed #D5DFCF' }}
          >
            <Box
              sx={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                bgcolor: '#F0F4EA',
                color: 'primary.main',
                display: 'grid',
                placeItems: 'center',
                mx: 'auto',
                mb: 1.5
              }}
            >
              <RestaurantRounded sx={{ fontSize: 28 }} />
            </Box>
            <Typography sx={{ fontWeight: 650 }}>今天还没有记录</Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, mb: 1 }}
            >
              拍下这一餐，让每一次用心都被看见。
            </Typography>
            <Button
              onClick={() => setShowFlow(true)}
              startIcon={<CameraAltRounded />}
            >
              拍照记录
            </Button>
          </Paper>
        )}
        {!loading && !error && (
          <Stack spacing={1.5}>
            {records.map((r) => (
              <Paper
                component="article"
                aria-label={`${r.food_name}记录`}
                key={r.id}
                sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}
              >
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center' }}
                >
                  <Box
                    sx={{
                      bgcolor: '#F3EEDF',
                      color: '#A87544',
                      width: 46,
                      height: 52,
                      borderRadius: 3,
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0
                    }}
                  >
                    <RestaurantRounded />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {mealNames[r.meal_type] || '饮食记录'} · {r.portion}
                    </Typography>
                    <Typography
                      sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
                    >
                      {r.food_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      蛋白质 {r.protein_g?.toFixed(0)}g · 脂肪{' '}
                      {r.fat_g?.toFixed(0)}g
                    </Typography>
                  </Box>
                  <Stack sx={{ alignItems: 'flex-end' }}>
                    <Typography sx={{ fontSize: 19, fontWeight: 750 }}>
                      {r.calories?.toFixed(0)}
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 0.5 }}
                      >
                        kcal
                      </Typography>
                    </Typography>
                    <IconButton
                      onClick={() => del(r.id)}
                      aria-label="删除记录"
                      size="small"
                      sx={{ color: 'text.secondary' }}
                    >
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
      {showChart && (
        <Suspense
          fallback={
            <Dialog open onClose={() => setShowChart(false)}>
              <DialogContent>
                <CircularProgress aria-label="正在加载营养趋势" />
              </DialogContent>
            </Dialog>
          }
        >
          <NutritionChart onClose={() => setShowChart(false)} />
        </Suspense>
      )}
      {showFlow && (
        <FoodFlow
          date={fmt(date)}
          onDone={() => {
            loadRecords()
            setShowFlow(false)
          }}
          onClose={() => setShowFlow(false)}
        />
      )}
    </Box>
  )
}

const STEP_LABELS = ['拍照', '识别', '选择', '份量', '保存']

function FoodFlow({
  date,
  onDone,
  onClose
}: {
  date: string
  onDone: () => void
  onClose: () => void
}) {
  const [step, setStep] = useState<
    'camera' | 'identifying' | 'candidates' | 'portion' | 'saving'
  >('camera')
  const stepIdx = [
    'camera',
    'identifying',
    'candidates',
    'portion',
    'saving'
  ].indexOf(step)
  const [imageId, setImageId] = useState(0)
  const [preview, setPreview] = useState('')
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview]
  )
  const [candidates, setCandidates] = useState<IdentifyResult[]>([])
  const [selected, setSelected] = useState<IdentifyResult | null>(null)
  const [grams, setGrams] = useState(300)
  const [estimated, setEstimated] = useState<IntakeResult | null>(null)
  const [estimating, setEstimating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const estimateVersion = useRef(0)

  useEffect(
    () => () => {
      clearTimeout(debounceRef.current)
      estimateVersion.current += 1
    },
    []
  )

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setStep('identifying')
    try {
      const img = await goApi.uploadImage(await prepareFoodImage(file))
      setImageId(img.id)
      const results = await agentApi.identifyFood(img.id)
      if (results.length === 0) {
        toast('未识别到食物，请重新拍照')
        setStep('camera')
        return
      }
      setCandidates(results)
      setStep('candidates')
    } catch (err) {
      toast('识别失败: ' + (err instanceof Error ? err.message : ''))
      setStep('camera')
    }
  }

  const selectCandidate = (c: IdentifyResult) => {
    setSelected(c)
    setGrams(c.default_portion.grams)
    setStep('portion')
    updateEstimate(c.name, c.default_portion.grams)
  }

  const updateEstimate = (foodName: string, g: number) => {
    const version = ++estimateVersion.current
    clearTimeout(debounceRef.current)
    setEstimated(null)
    const valid = Number.isFinite(g) && g > 0
    setEstimating(valid)
    if (!valid) return
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await agentApi.calculateIntake(foodName, g)
        if (version !== estimateVersion.current) return
        setEstimated(r)
      } catch {
        if (version === estimateVersion.current)
          toast('计算失败，请调整份量后重试')
      } finally {
        if (version === estimateVersion.current) setEstimating(false)
      }
    }, 500)
  }

  const canSave =
    !estimating &&
    selected !== null &&
    estimated !== null &&
    estimated.food_name === selected.name &&
    estimated.grams === grams &&
    grams > 0

  const save = async () => {
    if (!canSave || !selected || !estimated) return
    setStep('saving')
    try {
      await goApi.createDietLog({
        date,
        meal_type: 'snack',
        food_name: selected.name,
        portion: `${grams}g`,
        calories: estimated.calories,
        protein_g: estimated.protein_g,
        fat_g: estimated.fat_g,
        carbs_g: estimated.carbs_g,
        image_id: imageId
      })
      onDone()
    } catch (err) {
      toast('保存失败: ' + (err instanceof Error ? err.message : ''))
      setStep('portion')
    }
  }

  return (
    <Dialog
      fullScreen
      open
      onClose={step === 'saving' ? undefined : onClose}
      aria-labelledby="food-flow-title"
      slotProps={{ paper: { className: 'app-overlay' } }}
    >
      <DialogTitle id="food-flow-title" component="div" sx={{ px: 3, pt: 2.5 }}>
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Box>
            <Typography variant="overline" color="primary">
              ONE MEAL AT A TIME
            </Typography>
            <Typography variant="h2">记录这一餐</Typography>
          </Box>
          <IconButton
            onClick={onClose}
            disabled={step === 'saving'}
            aria-label="关闭"
          >
            <CloseRounded />
          </IconButton>
        </Stack>
      </DialogTitle>
      <Stepper
        activeStep={stepIdx}
        alternativeLabel
        sx={{ px: 1, pb: 3, '& .MuiStepLabel-label': { fontSize: 11 } }}
      >
        {STEP_LABELS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <DialogContent sx={{ px: 3, pb: 4 }}>
        {step === 'camera' && (
          <Stack spacing={2.5} sx={{ alignItems: 'center', pt: 2 }}>
            <Box
              sx={{
                width: '100%',
                aspectRatio: '1.3',
                bgcolor: '#EAF0E4',
                border: '1px dashed #A8B99E',
                borderRadius: 5,
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Box
                sx={{
                  border: '2px solid #A5B79C',
                  borderRadius: '50%',
                  p: 4,
                  color: 'primary.main'
                }}
              >
                <CameraAltRounded sx={{ fontSize: 58 }} />
              </Box>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h3">拍一张你的食物照片</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                光线充足、食物清晰，更容易识别。
                <br />
                你可以在下一步确认食物和份量。
              </Typography>
            </Box>
            <Button
              fullWidth
              variant="contained"
              size="large"
              startIcon={<CameraAltRounded />}
              onClick={() => cameraRef.current?.click()}
            >
              拍照
            </Button>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<PhotoLibraryRounded />}
              onClick={() => fileRef.current?.click()}
            >
              从相册选择
            </Button>
            <input
              ref={fileRef}
              aria-label="选择食物照片"
              type="file"
              accept="image/*"
              hidden
              onChange={handleFile}
            />
            <input
              ref={cameraRef}
              aria-label="拍摄食物照片"
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={handleFile}
            />
          </Stack>
        )}
        {(step === 'identifying' || step === 'saving') && (
          <Stack spacing={3} sx={{ alignItems: 'center', pt: 4 }}>
            {preview && (
              <Box
                component="img"
                src={preview}
                alt="本次记录的食物照片"
                sx={{
                  width: '100%',
                  maxHeight: 260,
                  objectFit: 'cover',
                  borderRadius: 4
                }}
              />
            )}
            <CircularProgress size={34} />
            <Typography variant="h3">
              {step === 'saving' ? '正在保存...' : 'AI 正在识别你的食物...'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {step === 'saving'
                ? `${selected?.name} · ${grams}g`
                : '正在寻找匹配的食物，请稍等片刻。'}
            </Typography>
          </Stack>
        )}
        {step === 'candidates' && (
          <Stack spacing={2}>
            {preview && (
              <Box
                component="img"
                src={preview}
                alt="本次记录的食物照片"
                sx={{
                  width: '100%',
                  height: 170,
                  objectFit: 'cover',
                  borderRadius: 4
                }}
              />
            )}
            <Box>
              <Typography variant="h3">这餐吃了什么？</Typography>
              <Typography variant="body2" color="text.secondary">
                识别结果，请选择一个：
              </Typography>
            </Box>
            {candidates.map((c) => (
              <Paper
                key={c.name}
                sx={{
                  overflow: 'hidden',
                  border: '1px solid',
                  borderColor: 'divider'
                }}
              >
                <CardActionArea
                  onClick={() => selectCandidate(c)}
                  sx={{ p: 2.5 }}
                >
                  <Stack
                    direction="row"
                    spacing={2}
                    sx={{
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{c.name}</Typography>
                    <Typography variant="caption" color="primary">
                      {(c.confidence * 100).toFixed(1)}% 匹配
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Math.max(0, c.confidence * 100))}
                    sx={{
                      my: 1.5,
                      height: 4,
                      borderRadius: 2,
                      bgcolor: '#E9F0E4'
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    每100g: {c.nutrition_per_100g.calories}kcal · 默认
                    {c.default_portion.grams}g/{c.default_portion.unit}
                  </Typography>
                </CardActionArea>
              </Paper>
            ))}
            <Button onClick={() => setStep('camera')}>重新拍照</Button>
          </Stack>
        )}
        {step === 'portion' && selected && (
          <Stack spacing={3}>
            <Paper
              sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}
            >
              {preview && (
                <Box
                  component="img"
                  src={preview}
                  alt="本次记录的食物照片"
                  sx={{
                    width: 72,
                    height: 72,
                    borderRadius: 3,
                    objectFit: 'cover'
                  }}
                />
              )}
              <Box>
                <Typography variant="h3">{selected.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  每100g: {selected.nutrition_per_100g.calories}kcal
                </Typography>
              </Box>
            </Paper>
            <Box>
              <Typography variant="h3" sx={{ mb: 1 }}>
                吃了多少克？
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                按实际食用份量调整，营养数据会同步更新。
              </Typography>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center' }}
              >
                <IconButton
                  aria-label="减少 50 克"
                  onClick={() => {
                    const g = Math.max(10, grams - 50)
                    setGrams(g)
                    updateEstimate(selected.name, g)
                  }}
                  sx={{
                    bgcolor: 'white',
                    border: '1px solid',
                    borderColor: 'divider'
                  }}
                >
                  <RemoveRounded />
                </IconButton>
                <TextField
                  type="number"
                  value={grams}
                  onChange={(e) => {
                    const g = parseInt(e.target.value) || 0
                    setGrams(g)
                    updateEstimate(selected.name, g)
                  }}
                  slotProps={{
                    htmlInput: {
                      'aria-label': '食物克数',
                      min: 1,
                      inputMode: 'numeric',
                      style: {
                        textAlign: 'center',
                        fontSize: 30,
                        fontWeight: 700
                      }
                    }
                  }}
                />
                <IconButton
                  aria-label="增加 50 克"
                  onClick={() => {
                    const g = grams + 50
                    setGrams(g)
                    updateEstimate(selected.name, g)
                  }}
                  sx={{
                    bgcolor: 'white',
                    border: '1px solid',
                    borderColor: 'divider'
                  }}
                >
                  <AddRounded />
                </IconButton>
              </Stack>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', display: 'block', mt: 1 }}
              >
                克 / g
              </Typography>
            </Box>
            {estimating && <Skeleton height={150} />}
            {!estimating && estimated && (
              <Paper sx={{ p: 2.5, bgcolor: '#EAF1E5' }}>
                <Typography variant="body2" color="primary" sx={{ mb: 1.5 }}>
                  预计摄入
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 2
                  }}
                >
                  {[
                    { label: '热量', value: estimated.calories, unit: 'kcal' },
                    { label: '蛋白质', value: estimated.protein_g, unit: 'g' },
                    { label: '脂肪', value: estimated.fat_g, unit: 'g' },
                    { label: '碳水', value: estimated.carbs_g, unit: 'g' }
                  ].map((item) => (
                    <Box key={item.label}>
                      <Typography variant="caption" color="text.secondary">
                        {item.label}
                      </Typography>
                      <Typography sx={{ fontSize: 25, fontWeight: 750 }}>
                        <span>{item.value.toFixed(0)}</span>{' '}
                        <Typography component="span" variant="caption">
                          {item.unit}
                        </Typography>
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Paper>
            )}
            <Button
              onClick={save}
              disabled={!canSave}
              variant="contained"
              fullWidth
              size="large"
            >
              确认记录
            </Button>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  )
}
