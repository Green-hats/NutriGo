import { NavLink } from 'react-router-dom'
import { MessageCircle, UtensilsCrossed, User } from 'lucide-react'

const tabs = [
  { to: '/chat', icon: MessageCircle, label: '对话' },
  { to: '/diary', icon: UtensilsCrossed, label: '日记' },
  { to: '/profile', icon: User, label: '我的' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-2 flex justify-around z-50">
      {tabs.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 text-xs transition-colors ${
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
