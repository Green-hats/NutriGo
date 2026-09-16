import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import BottomNav from './BottomNav'

export default function AppLayout() {
  return (
    <Box className="app-shell">
      <Box component="main" className="app-content">
        <Suspense
          fallback={
            <Box
              sx={{
                display: 'grid',
                placeItems: 'center',
                height: '100%',
                minHeight: 160
              }}
            >
              <CircularProgress aria-label="正在加载页面" />
            </Box>
          }
        >
          <Outlet />
        </Suspense>
      </Box>
      <BottomNav />
    </Box>
  )
}
