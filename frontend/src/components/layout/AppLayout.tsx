import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function AppLayout() {
  return (
    <div className="min-h-screen max-w-md md:max-w-2xl lg:max-w-4xl mx-auto bg-white relative pb-16">
      <Outlet />
      <BottomNav />
    </div>
  )
}
