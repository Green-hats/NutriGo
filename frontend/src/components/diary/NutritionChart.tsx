import { ConnectionNotice } from '../ui/ConnectionNotice'
import { errorMessage } from '../../lib/connection'
import { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import BarChartRounded from '@mui/icons-material/BarChartRounded'
import { goApi } from '../../api/go'
import { ErrorBlock } from '../ui/ErrorBlock'
import { Skeleton } from '../ui/Skeleton'

export default function NutritionChart({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<
    Array<{
      date: string
      kcal: number
      protein: number
      fat: number
      carbs: number
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState(7)
  const [metric, setMetric] = useState('calories')
  const load = useCallback((days: number) => {
    setLoading(true)
    setError('')
    const end = new Date().toISOString().slice(0, 10)
    const start = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 10)
    goApi
      .getSummaries(start, end)
      .then((res) => {
        setData(
          res.items
            .map((r) => ({
              date: r.date.slice(5),
              kcal: Math.round(r.total_calories),
              protein: Math.round(r.total_protein_g),
              fat: Math.round(r.total_fat_g),
              carbs: Math.round(r.total_carbs_g)
            }))
            .reverse()
        )
      })
      .catch((err) => setError(errorMessage(err, '趋势数据加载失败')))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load(range)
  }, [range, load])
  return (
    <Dialog
      fullScreen
      open
      onClose={onClose}
      aria-labelledby="nutrition-chart-title"
      slotProps={{ paper: { className: 'app-overlay' } }}
    >
      <ConnectionNotice />
      <DialogTitle id="nutrition-chart-title" component="div">
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="primary">
              YOUR PROGRESS
            </Typography>
            <Typography variant="h2">营养趋势</Typography>
          </Box>
          <IconButton aria-label="关闭营养趋势" onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ px: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          把每一餐连起来，看见自己的饮食节奏。
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          value={range}
          onChange={(_e, next: number | null) => {
            if (next) setRange(next)
          }}
          aria-label="趋势时间范围"
          sx={{ mb: 3 }}
        >
          {[7, 14, 30].map((d) => (
            <ToggleButton key={d} value={d}>
              {d}天
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {loading ? (
          <Skeleton height={300} />
        ) : error ? (
          <ErrorBlock message={error} onRetry={() => load(range)} />
        ) : data.length === 0 ? (
          <Paper sx={{ px: 3, py: 6, textAlign: 'center' }}>
            <BarChartRounded sx={{ fontSize: 52, color: '#A9BEA0', mb: 2 }} />
            <Typography variant="h3">暂无数据</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              多记录几天饮食后，再来看看你的变化。
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2.5}>
            <Paper sx={{ p: 2.5, bgcolor: '#EAF1E4' }}>
              <Typography variant="body2" color="text.secondary">
                已记录日均摄入
              </Typography>
              <Typography sx={{ fontSize: 34, fontWeight: 750 }}>
                {Math.round(
                  data.reduce((sum, item) => sum + item.kcal, 0) / data.length
                )}{' '}
                <Typography component="span" variant="body2">
                  kcal
                </Typography>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                根据 {data.length} 天已有记录计算
              </Typography>
            </Paper>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={metric}
              onChange={(_e, next: string | null) => {
                if (next) setMetric(next)
              }}
              aria-label="营养指标"
            >
              <ToggleButton value="calories">热量</ToggleButton>
              <ToggleButton value="macros">三大营养素</ToggleButton>
            </ToggleButtonGroup>
            <Paper
              sx={{
                pt: 2.5,
                pb: 1.5,
                pr: 2,
                border: '1px solid',
                borderColor: 'divider'
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 2.5 }}
              >
                {metric === 'calories' ? '千卡 / kcal' : '克 / g'}
              </Typography>
              <Box sx={{ width: '100%', minWidth: 0, height: 280, mt: 1 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} barGap={2}>
                    <XAxis
                      dataKey="date"
                      fontSize={10}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#69786F' }}
                    />
                    <YAxis
                      fontSize={10}
                      width={44}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#69786F' }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 14,
                        border: '1px solid #DDE5D9',
                        fontSize: 12
                      }}
                      cursor={{ fill: '#F1F5ED' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                    {metric === 'calories' ? (
                      <Bar
                        dataKey="kcal"
                        name="热量(kcal)"
                        fill="#387657"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={32}
                      />
                    ) : (
                      <>
                        <Bar
                          dataKey="protein"
                          name="蛋白质(g)"
                          fill="#387657"
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          dataKey="fat"
                          name="脂肪(g)"
                          fill="#9385AD"
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          dataKey="carbs"
                          name="碳水(g)"
                          fill="#CEA16D"
                          radius={[3, 3, 0, 0]}
                        />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </Paper>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  )
}
