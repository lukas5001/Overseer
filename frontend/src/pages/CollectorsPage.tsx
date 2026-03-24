import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wifi, Plus, Download, X } from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import { getRole } from '../api/hooks'
import type { Collector, Tenant } from '../types'

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000
}

// ── New Collector Modal ──────────────────────────────────────────────────────

function NewCollectorModal({ onClose, tenants }: { onClose: () => void; tenants: Tenant[] }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/collectors/', { tenant_id: tenantId, name }).then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['collectors'] })
      if (data.api_key) setCreatedApiKey(data.api_key)
      else onClose()
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Neuer Collector</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {createdApiKey ? (
          <div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
              <p className="text-xs font-medium text-emerald-800 mb-1">API-Key (wird nur einmal angezeigt!):</p>
              <code className="text-xs bg-white px-2 py-1 rounded border border-emerald-200 block break-all">{createdApiKey}</code>
            </div>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700">
              Schließen
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="collector-01"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              {tenants.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tenant</label>
                  <select value={tenantId} onChange={e => setTenantId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
              <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
                {mutation.isPending ? 'Erstellen…' : 'Collector erstellen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Installer Modal ──────────────────────────────────────────────────────────

function InstallerModal({ collectorId, onClose }: { collectorId: string; onClose: () => void }) {
  const [os, setOs] = useState<'linux' | 'windows'>('linux')

  const download = () => {
    const url = `/api/v1/collectors/${collectorId}/installer?os=${os}`
    const token = localStorage.getItem('overseer_token')
    // Use fetch to get the installer with auth
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = os === 'linux' ? 'overseer-collector-install.sh' : 'overseer-collector-install.ps1'
        a.click()
      })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Installer herunterladen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3 mb-6">
          <label className="block text-xs font-medium text-gray-600 mb-1">Betriebssystem</label>
          <div className="flex gap-3">
            <button onClick={() => setOs('linux')}
              className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors',
                os === 'linux' ? 'border-overseer-600 bg-overseer-50 text-overseer-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
              Linux
            </button>
            <button onClick={() => setOs('windows')}
              className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors',
                os === 'windows' ? 'border-overseer-600 bg-overseer-50 text-overseer-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
              Windows
            </button>
          </div>
        </div>
        <button onClick={download}
          className="w-full py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 inline-flex items-center justify-center gap-2">
          <Download className="w-4 h-4" /> Download {os === 'linux' ? '.sh' : '.ps1'}
        </button>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CollectorsPage() {
  const [showNewModal, setShowNewModal] = useState(false)
  const [installerTarget, setInstallerTarget] = useState<string | null>(null)
  const role = getRole()
  const isSuperAdmin = role === 'super_admin'

  const { data: collectors = [], isLoading } = useQuery<Collector[]>({
    queryKey: ['collectors'],
    queryFn: () => api.get('/api/v1/collectors/').then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const tenantNames: Record<string, string> = {}
  tenants.forEach(t => { tenantNames[t.id] = t.name })

  return (
    <div className="p-8">
      {showNewModal && <NewCollectorModal onClose={() => setShowNewModal(false)} tenants={tenants} />}
      {installerTarget && <InstallerModal collectorId={installerTarget} onClose={() => setInstallerTarget(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Wifi className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Collectors</h1>
          <span className="text-sm text-gray-500 ml-2">{collectors.length} Collectors</span>
        </div>
        <button onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer Collector
        </button>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Letzter Heartbeat</th>
              {isSuperAdmin && <th className="px-6 py-3 text-left">Tenant</th>}
              <th className="px-6 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {collectors.map(c => {
              const online = isOnline(c.last_seen_at)
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{c.name}</p>
                      {c.hostname && <p className="text-xs text-gray-400">{c.hostname}</p>}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium',
                      online ? 'text-emerald-700' : 'text-red-600')}>
                      <span className={clsx('w-2 h-2 rounded-full', online ? 'bg-emerald-500' : 'bg-red-500')} />
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-500">
                    {c.last_seen_at
                      ? formatDistanceToNow(new Date(c.last_seen_at), { locale: de, addSuffix: true })
                      : 'Nie'}
                  </td>
                  {isSuperAdmin && (
                    <td className="px-6 py-3 text-gray-500 text-xs">{tenantNames[c.tenant_id] ?? c.tenant_id}</td>
                  )}
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => setInstallerTarget(c.id)}
                      className="inline-flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium">
                      <Download className="w-3.5 h-3.5" /> Installer
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
