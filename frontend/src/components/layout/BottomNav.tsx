import { NavLink } from 'react-router-dom'
import { MessageCircle, UtensilsCrossed, User } from 'lucide-react'

const tabs = [
  { to: '/chat', icon: MessageCircle, label: '对话' },
  { to: '/diary', icon: UtensilsCrossed, label: '日记' },
  { to: '/profile', icon: User, label: '我的' },
]

export default function BottomNav() {
  return (
    <nav aria-label="主导航" className="app-tabbar bg-white border-t border-gray-100 px-6 flex justify-around">
      {tabs.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `min-h-12 min-w-16 flex flex-col items-center justify-center gap-1 text-xs transition-colors ${
              isActive ? 'text-green-600' : 'text-gray-400'
            }`
          }
        >
          <Icon size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
