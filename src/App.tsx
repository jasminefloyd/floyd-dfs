import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navigation from './components/Navigation'
import { SportsNewsTicker } from './components/SportsNewsTicker'
import ScanPage from './pages/ScanPage'
import DesignSystem from './pages/DesignSystem'
import AdminConsole from './pages/admin/AdminConsole'
import { testSupabaseConnection } from './lib/testSupabase'
import { ToastProvider } from './components/ToastProvider'
import { useEnterTransition } from './hooks/useEnterTransition'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AdminGuard } from './components/AdminGuard'

function RouteFade({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const entered = useEnterTransition([location.pathname])

  return (
    <div
      className={`transition-opacity duration-[var(--transition-default)] ${
        entered ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {children}
    </div>
  )
}

function App() {
  useEffect(() => {
    if (import.meta.env.VITE_DEBUG_SUPABASE === 'true') {
      testSupabaseConnection()
    }
  }, [])

  return (
    <BrowserRouter>
      <ToastProvider>
        <ErrorBoundary>
          <Navigation />
          <SportsNewsTicker />
          <RouteFade>
            <Routes>
              <Route path="/" element={<ScanPage />} />
              <Route
                path="/admin/design-system"
                element={
                  <AdminGuard>
                    <AdminConsole>
                      <DesignSystem />
                    </AdminConsole>
                  </AdminGuard>
                }
              />
            </Routes>
          </RouteFade>
        </ErrorBoundary>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
