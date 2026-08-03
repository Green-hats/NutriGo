import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function AppLayout() {
  return (
    <div className="min-h-screen max-w-md mx-auto bg-white relative pb-16">
      <Outlet />
      <BottomNav />
    </div>
  )
}
