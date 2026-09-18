import { errorMessage } from '../lib/connection'
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Typography
} from '@mui/material'
import CameraAltRounded from '@mui/icons-material/CameraAltRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import EditRounded from '@mui/icons-material/EditRounded'
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import BarChartRounded from '@mui/icons-material/BarChartRounded'
import RestaurantRounded from '@mui/icons-material/RestaurantRounded'
import AddRounded from '@mui/icons-material/AddRounded'
import SpaRounded from '@mui/icons-material/SpaRounded'
import { goApi } from '../api/go'
import { toast } from '../lib/toast'
import { ErrorBlock } from '../components/ui/ErrorBlock'
import { Skeleton } from '../components/ui/Skeleton'
import { PageHeader } from '../components/layout/PageHeader'
import DietRecordEditor from '../components/diary/DietRecordEditor'
import type { DietRecord } from '../types'

import MealAnalysisFlow from '../components/diary/MealAnalysisFlow'

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
  const [editor, setEditor] = useState<DietRecord | 'new' | null>(null)
  const [manualMealType, setManualMealType] = useState<string | undefined>()
  const [pendingDelete, setPendingDelete] = useState<DietRecord | null>(null)
  const [deleting, setDeleting] = useState(false)
  const loadVersion = useRef(0)
  const loadRecords = useCallback(() => {
    const version = ++loadVersion.current
    setLoading(true)
    setError('')
    goApi
      .getDietLogs(fmt(date))
      .then((items) => { if (version === loadVersion.current) setRecords(items) })
      .catch((err) => { if (version === loadVersion.current) setError(errorMessage(err, '饮食记录加载失败')) })
      .finally(() => { if (version === loadVersion.current) setLoading(false) })
  }, [date])
  useEffect(() => {
    loadRecords()
    return () => { loadVersion.current += 1 }
  }, [loadRecords])
  const del = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    try {
      await goApi.deleteDietLog(pendingDelete.id)
      setPendingDelete(null)
      loadRecords()
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
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
        <Button variant="outlined" startIcon={<EditRounded />} onClick={() => { setManualMealType(undefined); setEditor('new') }}>
          手动记录
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
            {loading ? '加载中' : error ? '未能加载' : `${records.length} 条记录`}
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
                    <Stack direction="row">
                    <IconButton aria-label="编辑记录" size="small" onClick={() => setEditor(r)}>
                      <EditRounded fontSize="small" />
                    </IconButton>
                    <IconButton
                      onClick={() => setPendingDelete(r)}
                      aria-label="删除记录"
                      size="small"
                      sx={{ color: 'text.secondary' }}
                    >
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
      <Dialog open={pendingDelete !== null} onClose={deleting ? undefined : () => setPendingDelete(null)} aria-labelledby="delete-diet-title">
        <DialogTitle id="delete-diet-title">删除这条饮食记录？</DialogTitle>
        <DialogContent>将删除「{pendingDelete?.food_name}」及其摄入数据，删除后无法恢复。</DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setPendingDelete(null)}>取消</Button>
          <Button color="error" disabled={deleting} onClick={() => void del()}>{deleting ? '正在删除...' : '确认删除'}</Button>
        </DialogActions>
      </Dialog>
      {editor && <DietRecordEditor date={fmt(date)} record={editor === 'new' ? undefined : editor}
        initialMealType={manualMealType}
        onClose={() => setEditor(null)} onDone={() => { setEditor(null); loadRecords() }} />}
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
        <MealAnalysisFlow
          date={fmt(date)}
          onDone={() => {
            loadRecords()
            setShowFlow(false)
          }}
          onClose={() => { setShowFlow(false); loadRecords() }}
          onManual={(mealType) => { setManualMealType(mealType); setShowFlow(false); setEditor('new') }}
        />
      )}
    </Box>
  )
}
