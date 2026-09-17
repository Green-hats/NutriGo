import { describe, expect, it } from 'vitest'
import { defaultMealType } from './meal'

describe('按手机本地用餐时间预选餐次', () => {
  it.each([
    [0, 0, 'snack'], [4, 59, 'snack'], [5, 0, 'breakfast'], [7, 59, 'breakfast'],
    [9, 59, 'breakfast'], [10, 0, 'lunch'], [14, 59, 'lunch'],
    [15, 0, 'dinner'], [20, 59, 'dinner'], [21, 0, 'snack']
  ] as const)('%i:%i 预选 %s', (hour, minute, expected) => {
    // 使用本地时间构造，不能依赖 UTC 字符串导致凌晨选错餐次。
    expect(defaultMealType(new Date(2026, 8, 17, hour, minute))).toBe(expected)
  })
})
