export interface User {
  id: number
  username: string
}

export interface UserProfile {
  id?: number
  user_id?: number
  height_cm: number
  weight_kg: number
  age: number
  gender: string
  goal: string
  allergies: string[]
  dietary_habits: string[]
  chronic_diseases: string[]
}

export interface FoodImage {
  id: number
  filename: string
  mime_type: string
  size: number
}

export interface DietRecord {
  id: number
  user_id: number
  date: string
  meal_type: string
  food_name: string
  portion: string
  calories: number
  protein_g: number
  fat_g: number
  carbs_g: number
  notes?: string
  image_id?: number
  created_at: string
}

export interface DailySummary {
  id: number
  user_id: number
  date: string
  total_calories: number
  total_protein_g: number
  total_fat_g: number
  total_carbs_g: number
  meal_count: number
}

export interface IdentifyResult {
  name: string
  confidence: number
  nutrition_per_100g: {
    calories: number
    protein_g: number
    fat_g: number
    carbs_g: number
  }
  default_portion: {
    grams: number
    unit: string
  }
}

export interface IntakeResult {
  food_name: string
  grams: number
  calories: number
  protein_g: number
  fat_g: number
  carbs_g: number
  per_100g: {
    calories: number
    protein_g: number
    fat_g: number
    carbs_g: number
  }
}

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  toolResult?: string
  thinking?: string
}

export interface SessionInfo {
  id: number
  name: string
  created_at: string
}

export interface SessionDetail {
  id: number
  name: string
  user_id?: number | null
  system_msg: string
  messages: RawMessage[]
  created_at: string
  updated_at: string
}

// 后端存储的原始消息格式（含 tool_calls 等 LLM 协议字段）
export interface RawMessage {
  role: string
  content?: string | null
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
  thinking?: string
}

export interface DietLogInput {
  date: string
  meal_type: string
  food_name: string
  portion?: string
  calories?: number
  protein_g?: number
  fat_g?: number
  carbs_g?: number
  notes?: string
  image_id?: number
}

export interface IdentifyRequest {
  image_id: number
}

export interface RenameRequest {
  name: string
}
