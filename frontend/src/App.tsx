import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import ErrorOverviewPage from './pages/ErrorOverviewPage'
import HostDetailPage from './pages/HostDetailPage'
import HostsPage from './pages/HostsPage'
import TenantsPage from './pages/TenantsPage'
import LoginPage from './pages/LoginPage'

export default function App() {
  const isAuthenticated = !!localStorage.getItem('overseer_token')

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => window.location.reload()} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/errors" element={<ErrorOverviewPage />} />
        <Route path="/hosts" element={<HostsPage />} />
        <Route path="/hosts/:hostId" element={<HostDetailPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
      </Route>
      <Route path="/login" element={<LoginPage onLogin={() => window.location.reload()} />} />
    </Routes>
  )
}
