import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import ErrorOverviewPage from './pages/ErrorOverviewPage'
import HostDetailPage from './pages/HostDetailPage'
import LoginPage from './pages/LoginPage'

export default function App() {
  // TODO: Implement actual auth check
  const isAuthenticated = true

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/errors" element={<ErrorOverviewPage />} />
        <Route path="/hosts/:hostId" element={<HostDetailPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
    </Routes>
  )
}
