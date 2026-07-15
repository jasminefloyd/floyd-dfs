import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navigation from './components/Navigation'
import ScanPage from './pages/ScanPage'
import DesignSystem from './pages/DesignSystem'
import { testSupabaseConnection } from './lib/testSupabase'
import { ToastProvider } from './components/ToastProvider'
import { useEnterTransition } from './hooks/useEnterTransition'

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
    testSupabaseConnection()
  }, [])

  return (
    <BrowserRouter>
      <ToastProvider>
        <Navigation />
        <RouteFade>
          <Routes>
            <Route path="/" element={<ScanPage />} />
            <Route path="/design-system" element={<DesignSystem />} />
          </Routes>
        </RouteFade>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
