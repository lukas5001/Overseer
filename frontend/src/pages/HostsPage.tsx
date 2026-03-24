import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Monitor, Server, Router, Printer, Shield, Wifi, HelpCircle, Plus, X, Search, ChevronDown, ChevronRight, Eye, EyeOff, Power, Copy, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../api/client'

interface HostItem {
  id: string
  hostname: string
  display_name: string | null
  ip_address: string | null
  host_type: string
  tenant_id: string
  tenant_name: string | null
  active: boolean
  tenant_active: boolean
  collector_offline: boolean
}

interface StatusSummary {
  [host_id: string]: 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
}

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server,
  switch: Router,
  router: Router,
  printer: Printer,
  firewall: Shield,
  access_point: Wifi,
}

const statusDot: Record<string, string> = {
  OK:       'bg-emerald-500',
  WARNING:  'bg-amber-400',
  CRITICAL: 'bg-red-500',
  UNKNOWN:  'bg-gray-300',
}

const HOST_TYPES = ['server', 'switch', 'router', 'printer', 'firewall', 'access_point', 'other']

// ── Add Host Modal ─────────────────────────────────────────────────────────────

interface AddHostModalProps {
  onClose: () => void
  onSaved: () => void
}

function AddHostModal({ onClose, onSaved }: AddHostModalProps) {
  const [form, setForm] = useState({
    hostname: '',
    display_name: '',
    ip_address: '',
    host_type: 'server',
    snmp_community: '',
    snmp_version: '2c',
    tenant_id: '',
    collector_id: '',
  })
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const { data: collectors = [] } = useQuery<{ id: string; name: string; tenant_id: string }[]>({
    queryKey: ['collectors-list'],
    queryFn: () => api.get('/api/v1/collectors/').then(r => r.data),
    enabled: tenants.length > 0,
  })

  const filteredCollectors = form.tenant_id
    ? collectors.filter(c => c.tenant_id === form.tenant_id)
    : collectors

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/hosts/', {
      hostname: form.hostname,
      display_name: form.display_name || null,
      ip_address: form.ip_address || null,
      host_type: form.host_type,
      snmp_community: form.snmp_community || null,
      snmp_version: form.snmp_version,
      tenant_id: form.tenant_id,
      collector_id: form.collector_id || null,
    }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Host anlegen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tenant *</label>
              <select value={form.tenant_id} onChange={set('tenant_id')}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                <option value="">– wählen –</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Collector</label>
              <select value={form.collector_id} onChange={set('collector_id')}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                <option value="">– keiner (nur aktive Checks) –</option>
                {filteredCollectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hostname *</label>
              <input value={form.hostname} onChange={set('hostname')} placeholder="switch-01.example.com"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
              <input value={form.display_name} onChange={set('display_name')} placeholder="Switch EG"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IP-Adresse</label>
              <input value={form.ip_address} onChange={set('ip_address')} placeholder="192.168.1.1"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Typ</label>
              <select value={form.host_type} onChange={set('host_type')}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {HOST_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SNMP Community</label>
              <input value={form.snmp_community} onChange={set('snmp_community')} placeholder="public"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SNMP Version</label>
              <select value={form.snmp_version} onChange={set('snmp_version')}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                <option value="1">v1</option>
                <option value="2c">v2c</option>
                <option value="3">v3</option>
              </select>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.hostname || !form.tenant_id}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Host anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HostsPage() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedTenants, setExpandedTenants] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('hosts-expanded-tenants')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const [showInactive, setShowInactive] = useState(true)

  // Load user preference for show_inactive
  const { data: userProfile } = useQuery<{ show_inactive?: boolean }>({
    queryKey: ['user-me'],
    queryFn: () => api.get('/api/v1/auth/me').then(r => r.data),
    staleTime: 60000,
  })

  useEffect(() => {
    if (userProfile?.show_inactive !== undefined) setShowInactive(userProfile.show_inactive)
  }, [userProfile])

  const toggleShowInactive = () => {
    const next = !showInactive
    setShowInactive(next)
    api.put('/api/v1/auth/preferences', { show_inactive: next })
    queryClient.invalidateQueries({ queryKey: ['user-me'] })
  }

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/v1/hosts/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hosts-all'] }),
  })

  const deleteHostMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/hosts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hosts-all'] }),
  })

  const copyHostMutation = useMutation({
    mutationFn: ({ id, hostname, target_tenant_id }: { id: string; hostname?: string; target_tenant_id?: string }) =>
      api.post(`/api/v1/hosts/${id}/copy`, { hostname, target_tenant_id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hosts-all'] }),
  })

  const [copyHostTarget, setCopyHostTarget] = useState<{ id: string; hostname: string } | null>(null)
  const [copyHostname, setCopyHostname] = useState('')
  const [copyTenantId, setCopyTenantId] = useState('')
  const [copyHostError, setCopyHostError] = useState<string | null>(null)

  const { data: tenantsList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
    enabled: !!copyHostTarget,
  })

  // Load ALL hosts (no pagination – needed for search across all tenants)
  const { data: hosts = [], isLoading } = useQuery<HostItem[]>({
    queryKey: ['hosts-all', showInactive],
    queryFn: () =>
      api.get('/api/v1/hosts/', { params: { limit: 500, offset: 0, include_inactive: showInactive } })
        .then(async (r) => {
          const total = parseInt(r.headers['x-total-count'] ?? '0', 10)
          let all = r.data as HostItem[]
          // Fetch remaining pages if needed
          if (total > 500) {
            const pages = Math.ceil(total / 500)
            for (let p = 1; p < pages; p++) {
              const next = await api.get('/api/v1/hosts/', { params: { limit: 500, offset: p * 500, include_inactive: showInactive } })
              all = all.concat(next.data)
            }
          }
          return all
        }),
    refetchInterval: 30000,
    staleTime: 10000,
  })

  const { data: errors = [] } = useQuery<{ host_id: string; status: string }[]>({
    queryKey: ['error-overview'],
    queryFn: () => api.get('/api/v1/status/errors?include_downtime=true').then(r => r.data),
    refetchInterval: 10000,
  })

  const worstStatus: StatusSummary = {}
  for (const e of errors) {
    const cur = worstStatus[e.host_id]
    const rank: Record<string, number> = { CRITICAL: 3, WARNING: 2, UNKNOWN: 1, OK: 0 }
    if (!cur || rank[e.status] > rank[cur]) {
      worstStatus[e.host_id] = e.status as 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
    }
  }

  // Filter hosts by search
  const filteredHosts = useMemo(() => {
    if (!search) return hosts
    const q = search.toLowerCase()
    return hosts.filter(h =>
      h.hostname.toLowerCase().includes(q) ||
      (h.display_name?.toLowerCase().includes(q) ?? false) ||
      (h.ip_address?.toLowerCase().includes(q) ?? false) ||
      (h.tenant_name?.toLowerCase().includes(q) ?? false)
    )
  }, [hosts, search])

  // Group by tenant
  const tenantGroups = useMemo(() => {
    const groups: Record<string, { name: string; tenantActive: boolean; hosts: HostItem[]; statusCounts: Record<string, number>; inactiveCount: number }> = {}
    for (const h of filteredHosts) {
      const tid = h.tenant_id
      if (!groups[tid]) groups[tid] = { name: h.tenant_name ?? tid, tenantActive: h.tenant_active, hosts: [], statusCounts: { OK: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 }, inactiveCount: 0 }
      groups[tid].hosts.push(h)
      const effectiveActive = h.active && h.tenant_active
      if (!effectiveActive) {
        groups[tid].inactiveCount++
      } else {
        const status = worstStatus[h.id] ?? 'OK'
        groups[tid].statusCounts[status]++
      }
    }
    // Sort by tenant name
    return Object.entries(groups).sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [filteredHosts, worstStatus])

  const updateExpanded = (next: Set<string>) => {
    setExpandedTenants(next)
    localStorage.setItem('hosts-expanded-tenants', JSON.stringify([...next]))
  }

  const toggleTenant = (tid: string) => {
    const next = new Set(expandedTenants)
    next.has(tid) ? next.delete(tid) : next.add(tid)
    updateExpanded(next)
  }

  const expandAll = () => {
    updateExpanded(new Set(tenantGroups.map(([tid]) => tid)))
  }

  const collapseAll = () => {
    updateExpanded(new Set())
  }

  return (
    <div className="p-8">
      {showAdd && (
        <AddHostModal
          onClose={() => setShowAdd(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['hosts-all'] })}
        />
      )}

      {/* Copy Host Modal */}
      {copyHostTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Host kopieren</h2>
              <button onClick={() => setCopyHostTarget(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
              <p className="text-gray-500">Quelle:</p>
              <p className="font-medium text-gray-800">{copyHostTarget.hostname}</p>
              <p className="text-xs text-gray-400 mt-1">Alle Services werden mitkopiert.</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Neuer Hostname</label>
                <input
                  value={copyHostname}
                  onChange={e => setCopyHostname(e.target.value)}
                  placeholder={`${copyHostTarget.hostname}-copy`}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ziel-Tenant</label>
                <select
                  value={copyTenantId}
                  onChange={e => setCopyTenantId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                >
                  <option value="">Gleicher Tenant</option>
                  {tenantsList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            {copyHostError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{copyHostError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setCopyHostTarget(null)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
              <button
                onClick={() => {
                  setCopyHostError(null)
                  const body: { id: string; hostname?: string; target_tenant_id?: string } = { id: copyHostTarget.id }
                  if (copyHostname) body.hostname = copyHostname
                  if (copyTenantId) body.target_tenant_id = copyTenantId
                  copyHostMutation.mutate(body, {
                    onSuccess: () => { setCopyHostTarget(null); setCopyHostname(''); setCopyTenantId('') },
                    onError: (e: any) => setCopyHostError(e.response?.data?.detail ?? 'Fehler beim Kopieren'),
                  })
                }}
                disabled={copyHostMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {copyHostMutation.isPending ? 'Kopiere…' : 'Host kopieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Monitor className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Hosts</h1>
          <span className="text-sm text-gray-500 ml-2">
            {hosts.filter(h => h.active && h.tenant_active).length} aktiv
            {hosts.some(h => !h.active || !h.tenant_active) && <span className="text-gray-400"> · {hosts.filter(h => !h.active || !h.tenant_active).length} inaktiv</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleShowInactive}
            className={clsx(
              'flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors',
              showInactive
                ? 'border-gray-300 bg-gray-50 text-gray-600'
                : 'border-gray-200 text-gray-400 hover:bg-gray-50',
            )}
          >
            {showInactive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            Inaktive {showInactive ? 'sichtbar' : 'ausgeblendet'}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Host anlegen
          </button>
        </div>
      </div>

      {/* Search + controls */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Host, IP, Kunde suchen…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button onClick={expandAll} className="px-2 py-1.5 text-gray-500 hover:text-gray-700 rounded border border-gray-200 hover:bg-gray-50">
            Alle aufklappen
          </button>
          <button onClick={collapseAll} className="px-2 py-1.5 text-gray-500 hover:text-gray-700 rounded border border-gray-200 hover:bg-gray-50">
            Alle zuklappen
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="text-gray-400 text-sm">Lade…</div>
      )}

      {/* Grouped by tenant (collapsed by default) */}
      <div className="space-y-2">
        {tenantGroups.map(([tid, { name: tenantName, tenantActive, hosts: tenantHosts, statusCounts, inactiveCount }]) => {
          const isExpanded = expandedTenants.has(tid)
          const hasProblem = statusCounts.CRITICAL > 0 || statusCounts.WARNING > 0 || statusCounts.UNKNOWN > 0

          return (
            <div key={tid} className={clsx('bg-white rounded-xl border overflow-hidden', tenantActive ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-60')}>
              {/* Tenant header (clickable) */}
              <button
                onClick={() => toggleTenant(tid)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-gray-400" />
                    : <ChevronRight className="w-4 h-4 text-gray-400" />
                  }
                  <p className={clsx('text-sm font-semibold', tenantActive ? 'text-gray-800' : 'text-gray-400 line-through')}>{tenantName}</p>
                  {!tenantActive && (
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">INAKTIV</span>
                  )}
                  <span className="text-xs text-gray-400">{tenantHosts.length} Hosts</span>
                </div>
                <div className="flex items-center gap-2">
                  {statusCounts.CRITICAL > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      {statusCounts.CRITICAL}
                    </span>
                  )}
                  {statusCounts.WARNING > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      {statusCounts.WARNING}
                    </span>
                  )}
                  {statusCounts.UNKNOWN > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      {statusCounts.UNKNOWN}
                    </span>
                  )}
                  {!hasProblem && statusCounts.OK > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      OK
                    </span>
                  )}
                  {inactiveCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                      {inactiveCount} inaktiv
                    </span>
                  )}
                </div>
              </button>

              {/* Host table (shown when expanded) */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <tr>
                        <th className="px-6 py-2 text-left">Host</th>
                        <th className="px-6 py-2 text-left">IP</th>
                        <th className="px-6 py-2 text-left">Typ</th>
                        <th className="px-6 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {tenantHosts.map(host => {
                        const HostIcon = hostTypeIcons[host.host_type] ?? HelpCircle
                        const effectiveActive = host.active && host.tenant_active
                        const status = effectiveActive ? (worstStatus[host.id] ?? 'OK') : 'INACTIVE'
                        const dotClass = effectiveActive ? statusDot[status] : 'bg-gray-300'
                        return (
                          <tr key={host.id} className={clsx('hover:bg-gray-50', !effectiveActive && 'opacity-50')}>
                            <td className="px-6 py-2.5">
                              <Link
                                to={`/hosts/${host.id}`}
                                className="flex items-center gap-2 hover:text-overseer-600"
                              >
                                <HostIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <div>
                                  <p className={clsx('font-medium', effectiveActive ? 'text-gray-900' : 'text-gray-400 line-through')}>
                                    {host.display_name || host.hostname}
                                  </p>
                                  {host.display_name && (
                                    <p className="text-xs text-gray-400">{host.hostname}</p>
                                  )}
                                </div>
                              </Link>
                            </td>
                            <td className="px-6 py-2.5 text-gray-500 font-mono text-xs">
                              {host.ip_address ?? '–'}
                            </td>
                            <td className="px-6 py-2.5 text-gray-500 capitalize">
                              {host.host_type.replace('_', ' ')}
                            </td>
                            <td className="px-6 py-2.5">
                              <div className="flex items-center gap-2">
                                {!effectiveActive ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400">
                                    <span className="w-2 h-2 rounded-full bg-gray-300" />
                                    INAKTIV
                                  </span>
                                ) : (
                                  <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium',
                                    status === 'OK' ? 'text-emerald-700' :
                                    status === 'WARNING' ? 'text-amber-700' :
                                    status === 'CRITICAL' ? 'text-red-700' : 'text-gray-500')}>
                                    <span className={clsx('w-2 h-2 rounded-full', dotClass)} />
                                    {status}
                                  </span>
                                )}
                                {effectiveActive && host.collector_offline && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-300" title="Collector sendet keine Daten">
                                    Offline
                                  </span>
                                )}
                                <div className="flex items-center gap-1 ml-auto">
                                  <button
                                    onClick={(e) => { e.preventDefault(); setCopyHostTarget({ id: host.id, hostname: host.display_name || host.hostname }); setCopyHostname(''); setCopyTenantId(''); setCopyHostError(null) }}
                                    className="p-1 rounded border border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-300 transition-colors"
                                    title="Host kopieren"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.preventDefault(); toggleActiveMutation.mutate({ id: host.id, active: !host.active }) }}
                                    className={clsx(
                                      'p-1 rounded border transition-colors',
                                      host.active
                                        ? 'border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300'
                                        : 'border-emerald-300 text-emerald-500 hover:bg-emerald-50',
                                    )}
                                    title={host.active ? 'Host deaktivieren' : 'Host aktivieren'}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      if (confirm(`Host "${host.display_name || host.hostname}" endgültig löschen?`)) {
                                        deleteHostMutation.mutate(host.id)
                                      }
                                    }}
                                    className="p-1 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors"
                                    title="Host endgültig löschen"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* No results */}
      {!isLoading && filteredHosts.length === 0 && hosts.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-10 h-10 text-gray-300 mb-3" />
          <p className="text-gray-400 text-sm">Keine Hosts für "{search}" gefunden.</p>
        </div>
      )}
    </div>
  )
}
