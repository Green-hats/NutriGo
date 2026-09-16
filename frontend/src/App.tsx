import { lazy } from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { theme } from './theme'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import Toast from './components/ui/Toast'
import Login from './pages/Login'
import Register from './pages/Register'
import { useMobileViewport } from './lib/mobile'
const Chat = lazy(() => import('./pages/Chat'))
const Diary = lazy(() => import('./pages/Diary'))
const Profile = lazy(() => import('./pages/Profile'))

export default function App() {
  useMobileViewport()
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <Toast />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/chat" element={<Chat />} />
              <Route path="/diary" element={<Diary />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
