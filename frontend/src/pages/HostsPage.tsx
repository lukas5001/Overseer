import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Monitor, Server, Router, Printer, Shield, Wifi, HelpCircle,
  Plus, Search, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../api/client'
import type { Host, HostCreate, HostType, Collector, ServiceTemplate, Tenant } from '../types'

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server, switch: Router, router: Router,
  printer: Printer, firewall: Shield, access_point: Wifi,
}

const hostTypes: { value: HostType; label: string }[] = [
  { value: 'server', label: 'Server' },
  { value: 'switch', label: 'Switch' },
  { value: 'router', label: 'Router' },
  { value: 'printer', label: 'Drucker' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'access_point', label: 'Access Point' },
  { value: 'other', label: 'Sonstiges' },
]

const statusDot: Record<string, string> = {
  OK: 'bg-emerald-500', WARNING: 'bg-amber-400',
  CRITICAL: 'bg-red-500', UNKNOWN: 'bg-gray-300',
}

const PAGE_SIZE = 25

// ── New Host Modal ───────────────────────────────────────────────────────────

function NewHostModal({
  onClose,
  tenants,
  collectors,
  templates,
}: {
  onClose: () => void
  tenants: Tenant[]
  collectors: Collector[]
  templates: ServiceTemplate[]
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<HostCreate>({
    tenant_id: tenants[0]?.id ?? '',
    hostname: '',
    host_type: 'server',
    tags: [],
  })
  const [tagInput, setTagInput] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [showWinrm, setShowWinrm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const host = await api.post('/api/v1/hosts/', form).then(r => r.data)
      if (templateId) {
        await api.post(`/api/v1/templates/${templateId}/apply`, { host_id: host.id })
      }
      return host
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const set = (key: string, val: unknown) => setForm(prev => ({ ...prev, [key]: val }))
  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.tags?.includes(tag)) {
      set('tags', [...(form.tags ?? []), tag])
      setTagInput('')
    }
  }
  const removeTag = (tag: string) => set('tags', (form.tags ?? []).filter(t => t !== tag))

  const filteredCollectors = collectors.filter(c => c.tenant_id === form.tenant_id)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Neuer Host</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Tenant */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kunde *</label>
            <select value={form.tenant_id} onChange={e => set('tenant_id', e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" required>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Hostname + Display Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Hostname *</label>
              <input type="text" value={form.hostname} onChange={e => set('hostname', e.target.value)}
                placeholder="srv-dc01" required
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
              <input type="text" value={form.display_name ?? ''} onChange={e => set('display_name', e.target.value || undefined)}
                placeholder="Domain Controller 01"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
            </div>
          </div>

          {/* IP + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IP-Adresse</label>
              <input type="text" value={form.ip_address ?? ''} onChange={e => set('ip_address', e.target.value || undefined)}
                placeholder="192.168.1.1"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Typ *</label>
              <select value={form.host_type} onChange={e => set('host_type', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none">
                {hostTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Collector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Collector</label>
            <select value={form.collector_id ?? ''} onChange={e => set('collector_id', e.target.value || undefined)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none">
              <option value="">– Kein Collector –</option>
              {filteredCollectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Template */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Service-Template</label>
            <select value={templateId} onChange={e => setTemplateId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none">
              <option value="">– Kein Template –</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.checks.length} Checks)</option>)}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tags</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {(form.tags ?? []).map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                placeholder="Tag eingeben + Enter"
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
            </div>
          </div>

          {/* WinRM Section */}
          <details open={showWinrm} onToggle={e => setShowWinrm((e.target as HTMLDetailsElement).open)}>
            <summary className="text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700">
              WinRM-Konfiguration (optional)
            </summary>
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-gray-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Benutzername</label>
                  <input type="text" value={form.winrm_username ?? ''} onChange={e => set('winrm_username', e.target.value || undefined)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Passwort</label>
                  <input type="password" value={form.winrm_password ?? ''} onChange={e => set('winrm_password', e.target.value || undefined)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Transport</label>
                  <select value={form.winrm_transport ?? 'ntlm'} onChange={e => set('winrm_transport', e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500">
                    <option value="ntlm">NTLM</option>
                    <option value="kerberos">Kerberos</option>
                    <option value="basic">Basic</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Port</label>
                  <input type="number" value={form.winrm_port ?? 5985} onChange={e => set('winrm_port', parseInt(e.target.value) || undefined)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    <input type="checkbox" checked={form.winrm_ssl ?? false} onChange={e => set('winrm_ssl', e.target.checked)}
                      className="rounded border-gray-300" />
                    SSL
                  </label>
                </div>
              </div>
            </div>
          </details>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.hostname || !form.tenant_id}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Erstellen…' : 'Host erstellen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HostsPage() {
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const { data: hosts = [], isLoading } = useQuery<Host[]>({
    queryKey: ['hosts'],
    queryFn: () => api.get('/api/v1/hosts/').then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: errors = [] } = useQuery<{ host_id: string; status: string }[]>({
    queryKey: ['error-overview'],
    queryFn: () => api.get('/api/v1/status/errors?include_downtime=true').then(r => r.data),
    refetchInterval: 10_000,
  })

  // For the modal
  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })
  const { data: collectors = [] } = useQuery<Collector[]>({
    queryKey: ['collectors'],
    queryFn: () => api.get('/api/v1/collectors/').then(r => r.data),
  })
  const { data: templates = [] } = useQuery<ServiceTemplate[]>({
    queryKey: ['service-templates'],
    queryFn: () => api.get('/api/v1/templates/').then(r => r.data),
  })

  // Worst status per host
  const worstStatus: Record<string, string> = {}
  const rank: Record<string, number> = { CRITICAL: 3, WARNING: 2, UNKNOWN: 1, OK: 0 }
  for (const e of errors) {
    const cur = worstStatus[e.host_id]
    if (!cur || rank[e.status] > rank[cur]) worstStatus[e.host_id] = e.status
  }

  // Filter + paginate
  const filtered = useMemo(() => {
    if (!search) return hosts
    const q = search.toLowerCase()
    return hosts.filter(h => {
      const hay = `${h.hostname} ${h.display_name ?? ''} ${h.ip_address ?? ''} ${h.tenant_name ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [hosts, search])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageHosts = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Group by tenant
  const byTenant: Record<string, { name: string; hosts: Host[] }> = {}
  for (const h of pageHosts) {
    const tid = h.tenant_id
    if (!byTenant[tid]) byTenant[tid] = { name: h.tenant_name ?? tid, hosts: [] }
    byTenant[tid].hosts.push(h)
  }

  return (
    <div className="p-8">
      {showModal && (
        <NewHostModal onClose={() => setShowModal(false)} tenants={tenants} collectors={collectors} templates={templates} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Monitor className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Hosts</h1>
          <span className="text-sm text-gray-500 ml-2">{hosts.length} Hosts</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer Host
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-4">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
          placeholder="Host, IP oder Kunde suchen…"
          className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      {/* Grouped by tenant */}
      <div className="space-y-6">
        {Object.values(byTenant).map(({ name: tenantName, hosts: tenantHosts }) => (
          <div key={tenantName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">{tenantName}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left">Host</th>
                  <th className="px-6 py-3 text-left">IP</th>
                  <th className="px-6 py-3 text-left">Typ</th>
                  <th className="px-6 py-3 text-left">Tags</th>
                  <th className="px-6 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tenantHosts.map(host => {
                  const HostIcon = hostTypeIcons[host.host_type] ?? HelpCircle
                  const status = worstStatus[host.id] ?? 'OK'
                  const dotClass = statusDot[status] ?? statusDot.UNKNOWN
                  return (
                    <tr key={host.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <Link to={`/hosts/${host.id}`} className="flex items-center gap-2 hover:text-overseer-600">
                          <HostIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-gray-900">{host.display_name || host.hostname}</p>
                            {host.display_name && <p className="text-xs text-gray-400">{host.hostname}</p>}
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-gray-500 font-mono text-xs">{host.ip_address ?? '–'}</td>
                      <td className="px-6 py-3 text-gray-500 capitalize">{host.host_type.replace('_', ' ')}</td>
                      <td className="px-6 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {(host.tags ?? []).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">{tag}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium',
                          status === 'OK' ? 'text-emerald-700' : status === 'WARNING' ? 'text-amber-700' : status === 'CRITICAL' ? 'text-red-700' : 'text-gray-500')}>
                          <span className={clsx('w-2 h-2 rounded-full', dotClass)} />
                          {status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-gray-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} von {filtered.length}
          </p>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-1.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
