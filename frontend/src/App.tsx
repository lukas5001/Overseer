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
import SecurityPage from './pages/SecurityPage'
import CollectorsPage from './pages/CollectorsPage'
import AlertRulesPage from './pages/AlertRulesPage'
import NotificationChannelsPage from './pages/NotificationChannelsPage'
import NotificationLogPage from './pages/NotificationLogPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import SlaReportsPage from './pages/SlaReportsPage'
import ServiceTemplatesPage from './pages/ServiceTemplatesPage'
import ScriptsPage from './pages/ScriptsPage'
import GlobalPoliciesPage from './pages/GlobalPoliciesPage'
import HostTypesPage from './pages/HostTypesPage'
import TvPage from './pages/TvPage'
import LoginPage from './pages/LoginPage'
import AiChatWidget from './components/AiChatWidget'

export default function App() {
  const isAuthenticated = !!localStorage.getItem('overseer_token')

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/tv" element={<TvPage />} />
        <Route path="*" element={<LoginPage onLogin={() => window.location.reload()} />} />
      </Routes>
    )
  }

  return (
    <>
      <Routes>
        {/* TV mode: no sidebar */}
        <Route path="/tv" element={<TvPage />} />

        {/* Main layout */}
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/errors" element={<ErrorOverviewPage />} />
          <Route path="/hosts" element={<HostsPage />} />
          <Route path="/hosts/:hostId" element={<HostDetailPage />} />
          <Route path="/collectors" element={<CollectorsPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/downtimes" element={<DowntimesPage />} />
          <Route path="/alert-rules" element={<AlertRulesPage />} />
          <Route path="/notifications" element={<NotificationChannelsPage />} />
          <Route path="/notification-log" element={<NotificationLogPage />} />
          <Route path="/webhooks" element={<NotificationsPage />} />
          <Route path="/templates" element={<ServiceTemplatesPage />} />
          <Route path="/scripts" element={<ScriptsPage />} />
          <Route path="/global-policies" element={<GlobalPoliciesPage />} />
          <Route path="/host-types" element={<HostTypesPage />} />
          <Route path="/sla" element={<SlaReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="*" element={
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
              <span className="text-6xl font-bold mb-4">404</span>
              <p className="text-lg mb-6">Seite nicht gefunden</p>
              <Link to="/dashboard" className="text-blue-400 hover:text-blue-300">Zurück zum Dashboard</Link>
            </div>
          } />
        </Route>

        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <AiChatWidget />
    </>
  )
}
