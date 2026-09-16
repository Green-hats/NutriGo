import { Navigate, Outlet } from 'react-router-dom'
import { isPreviewBuild, usePreviewStore } from '../../lib/preview'
import { useAuthStore } from '../../stores/auth'

export default function ProtectedRoute() {
  const token = useAuthStore((s) => s.token)
  const preview = usePreviewStore((s) => s.active)
  if (isPreviewBuild() ? !preview : !token)
    return <Navigate to="/login" replace />
  return <Outlet />
}
