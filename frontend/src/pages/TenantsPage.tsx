import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, Server, Key, Wifi } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface TenantStat {
  tenant_id: string
  tenant_name: string
  slug: string
  host_count: number
  service_count: number
  critical: number
  warning: number
  unknown: number
}

interface TenantDetail {
  collectors: { id: string; name: string; hostname: string | null; last_seen_at: string | null }[]
  api_keys: { id: string; name: string; key_prefix: string; last_used_at: string | null }[]
}

export default function TenantsPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: tenants = [], isLoading } = useQuery<TenantStat[]>({
    queryKey: ['tenant-stats'],
    queryFn: () => api.get('/api/v1/tenants/stats').then(r => r.data),
    refetchInterval: 30000,
  })

  const { data: detail } = useQuery<TenantDetail>({
    queryKey: ['tenant-detail', expanded],
    queryFn: () => api.get(`/api/v1/tenants/${expanded}/detail`).then(r => r.data),
    enabled: !!expanded,
  })

  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id))

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Building2 className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
        <span className="text-sm text-gray-500 ml-2">
          {tenants.length} {tenants.length === 1 ? 'Kunde' : 'Kunden'}
        </span>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="space-y-2">
        {tenants.map(t => (
          <div key={t.tenant_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Row */}
            <button
              onClick={() => toggle(t.tenant_id)}
              className="w-full flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors text-left"
            >
              <span className="text-gray-400">
                {expanded === t.tenant_id
                  ? <ChevronDown className="w-4 h-4" />
                  : <ChevronRight className="w-4 h-4" />}
              </span>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{t.tenant_name}</p>
                <p className="text-xs text-gray-400">{t.slug}</p>
              </div>

              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span title="Hosts">{t.host_count} Hosts</span>
                <span title="Services">{t.service_count} Checks</span>
              </div>

              <div className="flex items-center gap-2">
                {t.critical > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800">
                    {t.critical} CRIT
                  </span>
                )}
                {t.warning > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">
                    {t.warning} WARN
                  </span>
                )}
                {t.unknown > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-600">
                    {t.unknown} UNK
                  </span>
                )}
                {t.critical === 0 && t.warning === 0 && t.unknown === 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                    OK
                  </span>
                )}
              </div>
            </button>

            {/* Expanded detail */}
            {expanded === t.tenant_id && (
              <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 grid grid-cols-2 gap-6">
                {/* Collectors */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Wifi className="w-4 h-4 text-gray-400" />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Collectors</p>
                  </div>
                  {!detail ? (
                    <p className="text-xs text-gray-400">Lade…</p>
                  ) : detail.collectors.length === 0 ? (
                    <p className="text-xs text-gray-400">Keine Collectors</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.collectors.map(c => (
                        <div key={c.id} className="flex items-center gap-2 text-sm">
                          <Server className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
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

                {/* API Keys */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Key className="w-4 h-4 text-gray-400" />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API Keys</p>
                  </div>
                  {!detail ? (
                    <p className="text-xs text-gray-400">Lade…</p>
                  ) : detail.api_keys.length === 0 ? (
                    <p className="text-xs text-gray-400">Keine API Keys</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.api_keys.map(k => (
                        <div key={k.id} className="text-sm">
                          <p className="font-medium text-gray-800">{k.name}</p>
                          <p className="text-xs font-mono text-gray-500">
                            {k.key_prefix}…
                            <span
                              className={clsx(
                                'ml-2 text-xs',
                                k.last_used_at ? 'text-emerald-600' : 'text-gray-400',
                              )}
                            >
                              {k.last_used_at
                                ? `zuletzt: ${new Date(k.last_used_at).toLocaleString('de-DE')}`
                                : 'nie verwendet'}
                            </span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
