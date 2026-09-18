import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MealTypeField } from './MealTypeField'
import { defaultMealType } from '../../lib/meal'

afterEach(() => vi.useRealTimers())

function Field() {
  const [value, setValue] = useState(defaultMealType)
  return <MealTypeField value={value} onChange={setValue} />
}

it('夜间预选加餐后仍可手动改为午餐；时钟变化不会覆盖手动选择', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 17, 22))
  render(<Field />)
  expect(screen.getByRole('button', { name: '加餐' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '午餐' }))
  // 再次点击已选餐次不会清空它。
  fireEvent.click(screen.getByRole('button', { name: '午餐' }))
  act(() => { vi.setSystemTime(new Date(2026, 8, 18, 8)) })
  expect(screen.getByRole('button', { name: '午餐' })).toHaveAttribute('aria-pressed', 'true')
})

it('保存中禁止修改餐次', () => {
  const onChange = vi.fn()
  render(<MealTypeField value="dinner" onChange={onChange} disabled />)
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled()
    fireEvent.click(button)
  }
  expect(onChange).not.toHaveBeenCalled()
})
