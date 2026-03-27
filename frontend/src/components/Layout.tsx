import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, AlertTriangle, Monitor, Building2, Shield, ShieldCheck,
  LogOut, Users, Clock, ScrollText, Bell, Layers, Menu, X,
  ChevronLeft, ChevronRight, Wifi, BarChart3, Mail, ShieldAlert, Settings,
  FileCode2, Globe, Boxes, LayoutGrid, FileText, Radio, Radar,
} from 'lucide-react'
import clsx from 'clsx'

function getTokenPayload(): { role?: string; email?: string } | null {
  try {
    const token = localStorage.getItem('overseer_token')
    if (!token) return null
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

export default function Layout() {
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const payload = getTokenPayload()
  const role = payload?.role ?? null
  const email = payload?.email ?? null
  const isSuperAdmin = role === 'super_admin'
  const isAdmin = isSuperAdmin || role === 'tenant_admin'

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar-collapsed', String(next))
  }

  function logout() {
    localStorage.removeItem('overseer_token')
    navigate('/login')
  }

  // ── Navigation structure with groups ──
  const mainNav = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/custom-dashboards', label: 'Dashboards', icon: LayoutGrid },
    { to: '/errors', label: 'Fehlerübersicht', icon: AlertTriangle },
    { to: '/hosts', label: 'Hosts', icon: Monitor },
    { to: '/discovery', label: 'Discovery', icon: Radar },
    { to: '/collectors', label: 'Collectors', icon: Wifi },
    { to: '/downtimes', label: 'Downtimes', icon: Clock },
    { to: '/sla', label: 'SLA Reports', icon: BarChart3 },
    ...(isAdmin ? [{ to: '/reports', label: 'PDF Reports', icon: FileText }] : []),
    ...(isAdmin ? [{ to: '/status-pages', label: 'Status Pages', icon: Radio }] : []),
  ]

  const configNav = [
    ...(isAdmin ? [{ to: '/alert-rules', label: 'Alert-Regeln', icon: Bell }] : []),
    ...(isAdmin ? [{ to: '/notifications', label: 'Benachrichtigungen', icon: Mail }] : []),
    ...(isAdmin ? [{ to: '/notification-log', label: 'Notification Log', icon: ScrollText }] : []),
    ...(isAdmin ? [{ to: '/templates', label: 'Templates', icon: Layers }] : []),
    ...(isAdmin ? [{ to: '/scripts', label: 'Scripts', icon: FileCode2 }] : []),
    ...(isSuperAdmin ? [{ to: '/host-types', label: 'Host-Typen', icon: Boxes }] : []),
    ...(isSuperAdmin ? [{ to: '/global-policies', label: 'Global Policies', icon: Globe }] : []),
  ]

  const adminNav = isSuperAdmin ? [
    { to: '/tenants', label: 'Tenants', icon: Building2 },
    { to: '/users', label: 'Benutzer', icon: Users },
    { to: '/admin', label: 'Administration', icon: ShieldAlert },
    { to: '/audit', label: 'Audit Log', icon: ScrollText },
  ] : []

  const settingsNav = [
    { to: '/settings', label: 'Einstellungen', icon: Settings },
    { to: '/security', label: 'Sicherheit', icon: ShieldCheck },
  ]

  function renderNavGroup(items: typeof mainNav, label?: string, showLabel = true) {
    if (items.length === 0) return null
    return (
      <div>
        {label && showLabel && !collapsed && (
          <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            {label}
          </p>
        )}
        {label && showLabel && collapsed && <div className="my-2 mx-3 border-t border-white/10" />}
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                collapsed && 'justify-center',
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white'
              )
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </div>
    )
  }

  function renderSidebar(isMobile = false) {
    const isCollapsed = isMobile ? false : collapsed
    return (
      <>
        {/* Logo */}
        <div className={clsx('flex items-center border-b border-white/10', isCollapsed ? 'justify-center px-2 py-4' : 'justify-between px-5 py-4')}>
          <div className={clsx('flex items-center gap-2.5', isCollapsed && 'justify-center')}>
            <Shield className="w-7 h-7 text-blue-400 flex-shrink-0" />
            {!isCollapsed && <span className="text-lg font-bold tracking-tight">Overseer</span>}
          </div>
          {isMobile && (
            <button onClick={() => setMobileOpen(false)} className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className={clsx('flex-1 py-3 space-y-0.5 overflow-y-auto', isCollapsed ? 'px-2' : 'px-3')}>
          {renderNavGroup(mainNav)}
          {renderNavGroup(configNav, 'Konfiguration', true)}
          {renderNavGroup(adminNav, 'Administration', true)}
          {renderNavGroup(settingsNav, 'Einstellungen', true)}
        </nav>

        {/* Footer */}
        <div className={clsx('border-t border-white/10', isCollapsed ? 'px-2 py-3' : 'px-4 py-3')}>
          {!isCollapsed && email && (
            <p className="text-xs text-gray-400 truncate px-2 mb-2" title={email}>
              {email}
            </p>
          )}
          <button
            onClick={logout}
            title={isCollapsed ? 'Abmelden' : undefined}
            className={clsx(
              'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors',
              isCollapsed && 'justify-center'
            )}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!isCollapsed && 'Abmelden'}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Desktop sidebar ── */}
      <aside className={clsx(
        'hidden lg:flex bg-overseer-900 text-white flex-col flex-shrink-0 transition-[width] duration-200 relative',
        collapsed ? 'w-[68px]' : 'w-60',
      )}>
        {renderSidebar(false)}
        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3 top-7 w-6 h-6 rounded-full bg-overseer-800 border border-white/20 text-gray-400 hover:text-white flex items-center justify-center z-10 shadow"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </aside>

      {/* ── Mobile sidebar (slide-in drawer) ── */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 bg-overseer-900 text-white flex flex-col lg:hidden">
            {renderSidebar(true)}
          </aside>
        </>
      )}

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-overseer-900 text-white flex-shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-gray-300 hover:text-white">
            <Menu className="w-6 h-6" />
          </button>
          <Shield className="w-6 h-6 text-blue-400" />
          <span className="text-base font-bold tracking-tight">Overseer</span>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
