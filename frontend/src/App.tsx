import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, useAuthContext } from './contexts/AuthContext'
import { AdminLayout } from './components/layout/AdminLayout'

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const TournamentListPage = lazy(() => import('./pages/TournamentListPage').then((m) => ({ default: m.TournamentListPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const EntryManagementPage = lazy(() => import('./pages/EntryManagementPage').then((m) => ({ default: m.EntryManagementPage })))
const TeamManagementPage = lazy(() => import('./pages/TeamManagementPage').then((m) => ({ default: m.TeamManagementPage })))
const PublicBoardPage = lazy(() => import('./pages/PublicBoardPage').then((m) => ({ default: m.PublicBoardPage })))
const CSVImportPage = lazy(() => import('./pages/CSVImportPage').then((m) => ({ default: m.CSVImportPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const TournamentSettingsPage = lazy(() => import('./pages/TournamentSettingsPage').then((m) => ({ default: m.TournamentSettingsPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuthContext()
  if (loading) return <div className="flex h-screen items-center justify-center">読み込み中...</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PageFallback() {
  return <div className="flex h-screen items-center justify-center">読み込み中...</div>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/court_ladder">
        <AuthProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/public/:token" element={<PublicBoardPage />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <AdminLayout>
                      <Routes>
                        <Route path="/tournaments" element={<TournamentListPage />} />
                        <Route path="/tournaments/:tid" element={<DashboardPage />} />
                        <Route path="/tournaments/:tid/entries" element={<EntryManagementPage />} />
                        <Route path="/tournaments/:tid/teams" element={<TeamManagementPage />} />
                        <Route path="/tournaments/:tid/import" element={<CSVImportPage />} />
                        <Route path="/tournaments/:tid/history" element={<HistoryPage />} />
                        <Route path="/tournaments/:tid/settings" element={<TournamentSettingsPage />} />
                        <Route path="/" element={<Navigate to="/tournaments" replace />} />
                        <Route path="*" element={<NotFoundPage />} />
                      </Routes>
                    </AdminLayout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
