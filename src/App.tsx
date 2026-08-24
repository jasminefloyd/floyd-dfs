import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navigation from './components/Navigation'
import { SportsNewsTicker } from './components/SportsNewsTicker'
import ScanPage from './pages/ScanPage'
import HistoryPage from './pages/HistoryPage'
import RunPage from './pages/RunPage'
import ResearchPage from './pages/ResearchPage'
import LearningPage from './pages/LearningPage'
import DesignSystem from './pages/DesignSystem'
import AdminConsole from './pages/admin/AdminConsole'
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
  return (
    <BrowserRouter>
      <ToastProvider>
        <ErrorBoundary>
          <SportsNewsTicker />
          <Navigation />
          <RouteFade>
            <Routes>
              <Route path="/" element={<ScanPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/runs/:runId" element={<RunPage />} />
              <Route path="/research/:runId" element={<ResearchPage />} />
              <Route path="/learning" element={<LearningPage />} />
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
