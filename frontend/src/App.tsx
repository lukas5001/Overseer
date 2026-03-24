import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import ErrorOverviewPage from './pages/ErrorOverviewPage'
import HostDetailPage from './pages/HostDetailPage'
import HostsPage from './pages/HostsPage'
import TenantsPage from './pages/TenantsPage'
import CollectorsPage from './pages/CollectorsPage'
import AlertRulesPage from './pages/AlertRulesPage'
import NotificationChannelsPage from './pages/NotificationChannelsPage'
import SettingsPage from './pages/SettingsPage'
import AdminPage from './pages/AdminPage'
import SlaReportsPage from './pages/SlaReportsPage'
import ServiceTemplatesPage from './pages/ServiceTemplatesPage'
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
          <Route path="/alert-rules" element={<AlertRulesPage />} />
          <Route path="/notifications" element={<NotificationChannelsPage />} />
          <Route path="/templates" element={<ServiceTemplatesPage />} />
          <Route path="/sla" element={<SlaReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        <Route path="/login" element={<LoginPage onLogin={() => window.location.reload()} />} />
      </Routes>
      <AiChatWidget />
    </>
  )
}
