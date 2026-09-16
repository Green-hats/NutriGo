import { usePreviewStore } from '../lib/preview'
import { ConnectionError } from '../lib/connection'

function localDate(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Read-only fixtures, never a fallback for real requests. No credentials or user data are stored. */
export function previewResponse(url: string, options?: RequestInit): Response {
  if (!usePreviewStore.getState().active)
    throw new ConnectionError('unconfigured')
  const parsed = new URL(url, 'https://preview.invalid')
  const path = parsed.pathname
  if (
    (options?.method ?? 'GET').toUpperCase() !== 'GET' ||
    path.endsWith('/chat')
  ) {
    throw new Error(
      '离线界面体验只展示示例数据；AI 识别、对话和保存需要连接云端。'
    )
  }
  let data: unknown
  if (path === '/api/users/0/profile') {
    data = {
      height_cm: 170,
      weight_kg: 65,
      age: 25,
      gender: 'female',
      goal: 'maintain',
      allergies: ['示例：花生'],
      dietary_habits: ['清淡饮食'],
      chronic_diseases: []
    }
  } else if (path === '/api/diet/logs') {
    data =
      parsed.searchParams.get('date') !== localDate()
        ? []
        : [
            {
              id: 1,
              user_id: 0,
              date: localDate(),
              meal_type: 'breakfast',
              food_name: '示例 · 燕麦酸奶碗',
              portion: '250g',
              calories: 320,
              protein_g: 16,
              fat_g: 8,
              carbs_g: 46,
              created_at: ''
            },
            {
              id: 2,
              user_id: 0,
              date: localDate(),
              meal_type: 'lunch',
              food_name: '示例 · 鸡胸肉配蔬菜',
              portion: '350g',
              calories: 485,
              protein_g: 38,
              fat_g: 15,
              carbs_g: 48,
              created_at: ''
            }
          ]
  } else if (path === '/api/diet/summaries') {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      user_id: 0,
      date: localDate(i),
      total_calories: 805 + i * 120,
      total_protein_g: 54 + i * 2,
      total_fat_g: 23 + i * 3,
      total_carbs_g: 94 + i * 10,
      meal_count: 2
    }))
    data = { items, total: items.length, limit: 100, offset: 0 }
  } else if (path === '/agent-api/sessions') {
    data = {
      items: [
        { id: 1, name: '示例 · 午餐搭配', created_at: `${localDate()} 12:00` }
      ],
      total: 1,
      limit: 20,
      offset: 0
    }
  } else if (path === '/agent-api/sessions/1') {
    data = {
      id: 1,
      name: '示例 · 午餐搭配',
      messages: [
        { role: 'user', content: '给我一个午餐搭配的例子。' },
        {
          role: 'assistant',
          content:
            '**这是界面展示用的示例对话，并非实时 AI 回复。**\n\n你可以在这里体验长文本、列表和聊天布局。\n\n- 一份主食\n- 一份蛋白质来源\n- 两种蔬菜\n\n真实建议需要连接云端后生成。'
        }
      ]
    }
  } else {
    throw new Error('此功能需要连接云端，离线体验暂不提供。')
  }
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  })
}
