import { Skeleton as MuiSkeleton, type SkeletonProps } from '@mui/material'
export function Skeleton(props: SkeletonProps) {
  return <MuiSkeleton height={90} {...props} />
}
