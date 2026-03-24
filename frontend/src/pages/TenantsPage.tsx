import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, ChevronDown, ChevronRight, Server, Key, Wifi,
  Plus, Copy, BarChart3, X, Eye, EyeOff,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type { TenantStat, TenantDetail, TenantUsage } from '../types'

type DetailTab = 'api-keys' | 'users' | 'quotas' | 'collectors'

// ── New Tenant Modal ─────────────────────────────────────────────────────────

function NewTenantModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/tenants/', { name, slug }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenant-stats'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Neuer Tenant</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required
              placeholder="Mustermann GmbH"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
            <input type="text" value={slug} onChange={e => setSlug(e.target.value)} required
              placeholder="mustermann"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name || !slug}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Erstellen…' : 'Tenant erstellen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Detail Panel ──────────────────────────────────────────────────────

function TenantDetailPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<DetailTab>('api-keys')
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)

  const { data: detail } = useQuery<TenantDetail>({
    queryKey: ['tenant-detail', tenantId],
    queryFn: () => api.get(`/api/v1/tenants/${tenantId}/detail`).then(r => r.data),
    enabled: !!tenantId,
  })

  const { data: usage } = useQuery<TenantUsage>({
    queryKey: ['tenant-usage', tenantId],
    queryFn: () => api.get(`/api/v1/tenants/${tenantId}/usage`).then(r => r.data),
    enabled: activeTab === 'quotas',
  })

  const createKey = useMutation({
    mutationFn: () => api.post(`/api/v1/tenants/${tenantId}/api-keys`, { name: newKeyName }).then(r => r.data),
    onSuccess: (data: any) => {
      setCreatedKey(data.api_key)
      setNewKeyName('')
      qc.invalidateQueries({ queryKey: ['tenant-detail', tenantId] })
    },
  })

  const tabs: { key: DetailTab; label: string; icon: React.ElementType }[] = [
    { key: 'api-keys', label: 'API-Keys', icon: Key },
    { key: 'collectors', label: 'Collectors', icon: Wifi },
    { key: 'quotas', label: 'Quotas', icon: BarChart3 },
  ]

  return (
    <div className="border-t border-gray-100 bg-gray-50">
      {/* Tabs */}
      <div className="flex gap-4 px-6 pt-3 border-b border-gray-200">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={clsx('flex items-center gap-1.5 pb-2 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab.key ? 'border-overseer-600 text-overseer-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            <tab.icon className="w-3.5 h-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-4">
        {/* API Keys */}
        {activeTab === 'api-keys' && (
          <div>
            {createdKey && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-xs font-medium text-emerald-800 mb-1">Neuer API-Key (wird nur einmal angezeigt!):</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-white px-2 py-1 rounded border border-emerald-200 flex-1 break-all">
                    {showKey ? createdKey : '•'.repeat(40)}
                  </code>
                  <button onClick={() => setShowKey(!showKey)} className="text-emerald-600">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(createdKey); }}
                    className="text-emerald-600" title="Kopieren">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Key list */}
            {!detail ? <p className="text-xs text-gray-400">Lade…</p> : detail.api_keys.length === 0 ? (
              <p className="text-xs text-gray-400">Keine API Keys</p>
            ) : (
              <div className="space-y-2 mb-4">
                {detail.api_keys.map(k => (
                  <div key={k.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{k.name}</p>
                      <p className="text-xs text-gray-400">
                        {k.last_used_at ? `Zuletzt: ${new Date(k.last_used_at).toLocaleString('de-DE')}` : 'Nie verwendet'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create key */}
            <div className="flex gap-2">
              <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                placeholder="Key-Name" className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500" />
              <button onClick={() => createKey.mutate()} disabled={!newKeyName || createKey.isPending}
                className="px-3 py-1.5 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Collectors */}
        {activeTab === 'collectors' && (
          <div>
            {!detail ? <p className="text-xs text-gray-400">Lade…</p> : detail.collectors.length === 0 ? (
              <p className="text-xs text-gray-400">Keine Collectors</p>
            ) : (
              <div className="space-y-2">
                {detail.collectors.map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <Server className="w-3.5 h-3.5 text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-800">{c.name}</p>
                      {c.hostname && <p className="text-xs text-gray-400">{c.hostname}</p>}
                      {c.last_seen_at && (
                        <p className="text-xs text-gray-400">
                          zuletzt: {new Date(c.last_seen_at).toLocaleString('de-DE')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quotas */}
        {activeTab === 'quotas' && usage && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Hosts', current: usage.hosts.current, max: usage.hosts.max },
              { label: 'Services', current: usage.services.current, max: usage.services.max },
              { label: 'Collectors', current: usage.collectors.current, max: usage.collectors.max },
            ].map(q => {
              const pct = q.max > 0 ? (q.current / q.max) * 100 : 0
              return (
                <div key={q.label} className="bg-white rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-medium text-gray-500">{q.label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{q.current} / {q.max}</p>
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={clsx('h-full rounded-full', pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-500')}
                      style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TenantsPage() {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const { data: tenants = [], isLoading } = useQuery<TenantStat[]>({
    queryKey: ['tenant-stats'],
    queryFn: () => api.get('/api/v1/tenants/stats').then(r => r.data),
    refetchInterval: 30_000,
  })

  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id))

  return (
    <div className="p-8">
      {showModal && <NewTenantModal onClose={() => setShowModal(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <span className="text-sm text-gray-500 ml-2">{tenants.length} Kunden</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer Tenant
        </button>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="space-y-2">
        {tenants.map(t => (
          <div key={t.tenant_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Row */}
            <button onClick={() => toggle(t.tenant_id)}
              className="w-full flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors text-left">
              <span className="text-gray-400">
                {expanded === t.tenant_id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{t.tenant_name}</p>
                <p className="text-xs text-gray-400">{t.slug}</p>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span>{t.host_count} Hosts</span>
                <span>{t.service_count} Checks</span>
              </div>
              <div className="flex items-center gap-2">
                {t.critical > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">{t.critical} CRIT</span>
                )}
                {t.warning > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">{t.warning} WARN</span>
                )}
                {t.unknown > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-600">{t.unknown} UNK</span>
                )}
                {t.critical === 0 && t.warning === 0 && t.unknown === 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">OK</span>
                )}
              </div>
            </button>

            {/* Detail panel */}
            {expanded === t.tenant_id && <TenantDetailPanel tenantId={t.tenant_id} />}
          </div>
        ))}
      </div>
    </div>
  )
}
