export function defaultMealType(): string {
  const hour = new Date().getHours()
  return hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack'
}

