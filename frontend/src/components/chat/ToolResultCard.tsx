import { useId, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  CircularProgress,
  Stack,
  Typography
} from '@mui/material'
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import type { ChatMessage } from '../../types'

const TOOL_LABELS: Record<string, string> = {
  lookup_food_nutrition: '查询食物营养',
  get_user_profile: '查看健康档案',
  get_diet_history: '回顾饮食记录',
  get_diet_summary: '分析营养趋势',
  get_nutrition_trend: '分析营养趋势',
  get_nutrition_trends: '分析营养趋势',
  search_nutrition_knowledge: '查找营养知识',
  search_knowledge: '查找营养知识'
}

export default function ToolResultCard({
  message,
  isStreaming
}: {
  message: ChatMessage
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const label = TOOL_LABELS[message.toolName || ''] || '整理营养信息'

  if (message.toolResult === undefined) {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', ml: 4.5, py: 1, color: 'text.secondary' }}
        role="status"
      >
        {isStreaming && <CircularProgress size={14} />}
        <Typography variant="caption">
          {label}{isStreaming ? '中...' : ' · 未完成'}
        </Typography>
      </Stack>
    )
  }

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, value) => setExpanded(value)}
      disableGutters
      slotProps={{ transition: { unmountOnExit: true } }}
      sx={{
        ml: 4.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '14px !important',
        '&::before': { display: 'none' }
      }}
    >
      <AccordionSummary
        id={`${id}-summary`}
        aria-controls={`${id}-details`}
        aria-label={`${label} · 已完成 ${expanded ? '收起详情' : '查看详情'}`}
        expandIcon={<ExpandMoreRounded fontSize="small" />}
        sx={{ px: 1.5, minHeight: 48, '& .MuiAccordionSummary-content': { minWidth: 0 } }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <CheckCircleOutlineRounded sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Stack>
            <Typography variant="caption">{label} · 已完成</Typography>
            <Typography variant="caption" color="primary">
              {expanded ? '收起详情' : '查看详情'}
            </Typography>
          </Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1.5 }}>
        <Typography
          variant="body2"
          sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {message.toolResult || '本次查询未返回内容。'}
        </Typography>
      </AccordionDetails>
    </Accordion>
  )
}
