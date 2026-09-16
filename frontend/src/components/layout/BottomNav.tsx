import { NavLink, useLocation } from 'react-router-dom'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import RestaurantRounded from '@mui/icons-material/RestaurantRounded'
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded'

const tabs = [
  { to: '/chat', icon: ChatBubbleOutlineRounded, label: '对话' },
  { to: '/diary', icon: RestaurantRounded, label: '日记' },
  { to: '/profile', icon: PersonOutlineRounded, label: '我的' }
]

export default function BottomNav() {
  const { pathname } = useLocation()
  return (
    <Paper
      className="app-tabbar"
      square
      sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2 }}
    >
      <BottomNavigation
        component="nav"
        aria-label="主导航"
        value={pathname}
        showLabels
        sx={{ height: 62, bgcolor: 'transparent', gap: 1 }}
      >
        {tabs.map(({ to, icon: Icon, label }) => (
          <BottomNavigationAction
            key={to}
            component={NavLink}
            to={to}
            value={to}
            label={label}
            icon={<Icon />}
            sx={{
              minWidth: 0,
              maxWidth: 150,
              borderRadius: 3,
              color: 'text.secondary',
              gap: 0.5,
              py: 1,
              '&.Mui-selected': { bgcolor: '#EDF3E9', color: 'primary.main' },
              '& .MuiBottomNavigationAction-label, & .MuiBottomNavigationAction-label.Mui-selected':
                { fontSize: 11, fontWeight: 650 }
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
