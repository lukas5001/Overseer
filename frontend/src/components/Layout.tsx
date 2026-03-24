import { Outlet, NavLink } from 'react-router-dom'
import {
  LayoutDashboard, AlertTriangle, Monitor, Building2, Shield, Wifi,
  Bell, Mail, FileCode2, BarChart3, Settings, ShieldAlert, LogOut,
} from 'lucide-react'
import clsx from 'clsx'

function getRole(): string | null {
  try {
    const token = localStorage.getItem('overseer_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.role ?? null
  } catch {
    return null
  }
}

export default function Layout() {
  const role = getRole()
  const isSuperAdmin = role === 'super_admin'
  const isAdmin = isSuperAdmin || role === 'tenant_admin'

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/errors', label: 'Fehlerübersicht', icon: AlertTriangle },
    { to: '/hosts', label: 'Hosts', icon: Monitor },
    { to: '/collectors', label: 'Collectors', icon: Wifi },
    { to: '/sla', label: 'SLA Reports', icon: BarChart3 },
  ]

  const configItems = [
    ...(isAdmin ? [{ to: '/alert-rules', label: 'Alert-Regeln', icon: Bell }] : []),
    ...(isAdmin ? [{ to: '/notifications', label: 'Benachrichtigungen', icon: Mail }] : []),
    ...(isAdmin ? [{ to: '/templates', label: 'Templates', icon: FileCode2 }] : []),
    ...(isSuperAdmin ? [{ to: '/tenants', label: 'Tenants', icon: Building2 }] : []),
    ...(isSuperAdmin ? [{ to: '/admin', label: 'Administration', icon: ShieldAlert }] : []),
  ]

  const handleLogout = () => {
    localStorage.removeItem('overseer_token')
    window.location.href = '/login'
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-overseer-900 text-white flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          <Shield className="w-8 h-8 text-blue-400" />
          <span className="text-xl font-bold tracking-tight">Overseer</span>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                )
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}

          {/* Config section */}
          {configItems.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Konfiguration</p>
              </div>
              {configItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-gray-300 hover:bg-white/10 hover:text-white'
                    )
                  }
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-2">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive ? 'bg-white/15 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'
              )
            }
          >
            <Settings className="w-5 h-5" />
            Einstellungen
          </NavLink>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-white/10 hover:text-white transition-colors">
            <LogOut className="w-5 h-5" />
            Abmelden
          </button>
        </div>

        <div className="px-6 py-3 border-t border-white/10 text-xs text-gray-400">
          Overseer v0.1.0
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
