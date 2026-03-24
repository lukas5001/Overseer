import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import ErrorOverviewPage from './pages/ErrorOverviewPage'
import HostDetailPage from './pages/HostDetailPage'
import HostsPage from './pages/HostsPage'
import TenantsPage from './pages/TenantsPage'
import UsersPage from './pages/UsersPage'
import DowntimesPage from './pages/DowntimesPage'
import AuditLogPage from './pages/AuditLogPage'
import NotificationsPage from './pages/NotificationsPage'
import TemplatesPage from './pages/TemplatesPage'
import SecurityPage from './pages/SecurityPage'
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
        <Route path="/users" element={<UsersPage />} />
        <Route path="/downtimes" element={<DowntimesPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/audit" element={<AuditLogPage />} />
        <Route path="*" element={
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <span className="text-6xl font-bold mb-4">404</span>
            <p className="text-lg mb-6">Seite nicht gefunden</p>
            <Link to="/dashboard" className="text-blue-400 hover:text-blue-300">Zurück zum Dashboard</Link>
          </div>
        } />
      </Route>
      <Route path="/login" element={<LoginPage onLogin={() => window.location.reload()} />} />
    </Routes>
  )
}
