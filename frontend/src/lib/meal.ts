export function defaultMealType(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 5 || hour >= 21) return 'snack'
  return hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : 'dinner'
}
