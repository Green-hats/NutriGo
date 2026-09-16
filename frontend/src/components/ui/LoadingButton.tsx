import { Button, type ButtonProps } from '@mui/material'

export function LoadingButton({
  loading = false,
  children,
  ...props
}: ButtonProps) {
  return (
    <Button variant="contained" loading={loading} {...props}>
      {children}
    </Button>
  )
}
