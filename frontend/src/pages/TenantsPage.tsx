import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, Server, Key, Wifi, Plus, X, Copy, Check, Eye, EyeOff, Power, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { formatDateTime } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'

interface TenantStat {
  tenant_id: string
  tenant_name: string
  slug: string
  active: boolean
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

// ── Add Collector Modal ────────────────────────────────────────────────────────

interface AddCollectorModalProps {
  tenantId: string
  tenantName: string
  onClose: () => void
  onSaved: () => void
}

function AddCollectorModal({ tenantId, tenantName, onClose, onSaved }: AddCollectorModalProps) {
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [generatedKey, setGeneratedKey] = useState<{ collectorId: string; apiKey: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/collectors/', { tenant_id: tenantId, name, hostname: hostname || null }),
    onSuccess: (resp) => {
      setGeneratedKey({ collectorId: resp.data.id, apiKey: resp.data.api_key })
      onSaved()
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Anlegen'),
  })

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Collector anlegen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
          <p className="font-medium text-gray-800">{tenantName}</p>
        </div>

        {!generatedKey ? (
          <>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="collector-standort-a"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Hostname <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  value={hostname}
                  onChange={e => setHostname(e.target.value)}
                  placeholder="collector-vm.example.com"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
            )}
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Abbrechen
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !name}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {mutation.isPending ? 'Anlegen…' : 'Collector anlegen'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              API-Key und Collector-ID werden nur einmal angezeigt. Notiere sie für das Install-Script.
            </p>
            <div className="space-y-3 mb-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Collector-ID</p>
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-gray-700 font-mono break-all">{generatedKey.collectorId}</code>
                  <button onClick={() => copy(generatedKey.collectorId)} className="text-gray-400 hover:text-gray-700 flex-shrink-0">
                    {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">API-Key</p>
                <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                  <code className="flex-1 text-xs text-green-400 font-mono break-all">{generatedKey.apiKey}</code>
                  <button onClick={() => copy(generatedKey.apiKey)} className="text-gray-400 hover:text-white flex-shrink-0">
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <button onClick={onClose}
              className="w-full py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700">
              Schließen
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Add Tenant Modal ───────────────────────────────────────────────────────────

interface AddTenantModalProps {
  onClose: () => void
  onSaved: () => void
}

function AddTenantModal({ onClose, onSaved }: AddTenantModalProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/tenants/', { name, slug }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const autoSlug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Tenant anlegen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input
              value={name}
              onChange={e => { setName(e.target.value); if (!slug) setSlug(autoSlug(e.target.value)) }}
              placeholder="Mustermann GmbH"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug * <span className="font-normal text-gray-400">(URL-freundlich, einmalig)</span></label>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="mustermann-gmbh"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none font-mono"
            />
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
            disabled={mutation.isPending || !name || !slug}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Tenant anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Generate API Key Modal ─────────────────────────────────────────────────────

interface GenerateKeyModalProps {
  tenantId: string
  tenantName: string
  onClose: () => void
  onSaved: () => void
}

function GenerateKeyModal({ tenantId, tenantName, onClose, onSaved }: GenerateKeyModalProps) {
  const [keyName, setKeyName] = useState('collector-key')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/v1/tenants/${tenantId}/api-keys?name=${encodeURIComponent(keyName)}`),
    onSuccess: (resp) => {
      setGeneratedKey(resp.data.key)
      onSaved()
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Generieren'),
  })

  const copy = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">API-Key generieren</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
          <p className="font-medium text-gray-800">{tenantName}</p>
        </div>

        {!generatedKey ? (
          <>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Key-Name</label>
              <input
                value={keyName}
                onChange={e => setKeyName(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
            )}
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Abbrechen
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {mutation.isPending ? 'Generiere…' : 'Key generieren'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              Dieser Key wird nur einmal angezeigt. Kopiere ihn jetzt und speichere ihn sicher.
            </p>
            <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-4 py-3 mb-4">
              <code className="flex-1 text-xs text-green-400 break-all font-mono">{generatedKey}</code>
              <button onClick={copy} className="text-gray-400 hover:text-white ml-2 flex-shrink-0">
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button onClick={onClose}
              className="w-full py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700">
              Schließen
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function TenantsPage() {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [keyTarget, setKeyTarget] = useState<{ id: string; name: string } | null>(null)
  const [collectorTarget, setCollectorTarget] = useState<{ id: string; name: string } | null>(null)
  const [showInactive, setShowInactive] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

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

  const { data: tenants = [], isLoading } = useQuery<TenantStat[]>({
    queryKey: ['tenant-stats', showInactive],
    queryFn: () => api.get('/api/v1/tenants/stats', { params: { include_inactive: showInactive } }).then(r => r.data),
    refetchInterval: 30000,
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/v1/tenants/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-stats'] }),
  })

  const deleteTenantMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/tenants/${id}`),
    onSuccess: () => { setDeleteTarget(null); queryClient.invalidateQueries({ queryKey: ['tenant-stats'] }) },
    onError: () => setDeleteTarget(null),
  })

  const copyTenantMutation = useMutation({
    mutationFn: ({ id, name, slug }: { id: string; name: string; slug: string }) =>
      api.post(`/api/v1/tenants/${id}/copy`, { name, slug }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant-stats'] }),
  })

  const [copyTarget, setCopyTarget] = useState<{ id: string; name: string } | null>(null)
  const [copyName, setCopyName] = useState('')
  const [copySlug, setCopySlug] = useState('')
  const [copyError, setCopyError] = useState<string | null>(null)

  const { data: detail } = useQuery<TenantDetail>({
    queryKey: ['tenant-detail', expanded],
    queryFn: () => api.get(`/api/v1/tenants/${expanded}/detail`).then(r => r.data),
    enabled: !!expanded,
  })

  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id))

  return (
    <div className="p-8">
      {showAdd && (
        <AddTenantModal
          onClose={() => setShowAdd(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['tenant-stats'] })}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Tenant löschen"
        message={`Tenant "${deleteTarget?.name}" endgültig löschen?\n\nAlle Hosts, Services, Check-Ergebnisse und zugehörige Daten werden unwiderruflich gelöscht.`}
        confirmLabel="Endgültig löschen"
        variant="danger"
        loading={deleteTenantMutation.isPending}
        onConfirm={() => deleteTarget && deleteTenantMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
      {keyTarget && (
        <GenerateKeyModal
          tenantId={keyTarget.id}
          tenantName={keyTarget.name}
          onClose={() => setKeyTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['tenant-detail', keyTarget.id] })}
        />
      )}
      {collectorTarget && (
        <AddCollectorModal
          tenantId={collectorTarget.id}
          tenantName={collectorTarget.name}
          onClose={() => setCollectorTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['tenant-detail', collectorTarget.id] })}
        />
      )}

      {/* Copy Tenant Modal */}
      {copyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Tenant kopieren</h2>
              <button onClick={() => setCopyTarget(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
              <p className="text-gray-500">Quelle:</p>
              <p className="font-medium text-gray-800">{copyTarget.name}</p>
              <p className="text-xs text-gray-400 mt-1">Alle Hosts und Services werden mitkopiert.</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Neuer Name *</label>
                <input
                  value={copyName}
                  onChange={e => { setCopyName(e.target.value); setCopySlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }}
                  placeholder="Kopie von …"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Slug *</label>
                <input
                  value={copySlug}
                  onChange={e => setCopySlug(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none font-mono"
                />
              </div>
            </div>
            {copyError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{copyError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setCopyTarget(null)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
              <button
                onClick={() => {
                  setCopyError(null)
                  copyTenantMutation.mutate({ id: copyTarget.id, name: copyName, slug: copySlug }, {
                    onSuccess: () => { setCopyTarget(null); setCopyName(''); setCopySlug('') },
                    onError: (e: any) => setCopyError(e.response?.data?.detail ?? 'Fehler beim Kopieren'),
                  })
                }}
                disabled={copyTenantMutation.isPending || !copyName || !copySlug}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {copyTenantMutation.isPending ? 'Kopiere…' : 'Tenant kopieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <span className="text-sm text-gray-500 ml-2">
            {tenants.filter(t => t.active).length} aktiv
            {tenants.some(t => !t.active) && <span className="text-gray-400"> · {tenants.filter(t => !t.active).length} inaktiv</span>}
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
            Tenant anlegen
          </button>
        </div>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="space-y-2">
        {tenants.map(t => (
          <div key={t.tenant_id} className={clsx('bg-white rounded-xl border overflow-hidden', t.active ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-60')}>
            {/* Row */}
            <div className="flex items-center">
              <button
                onClick={() => toggle(t.tenant_id)}
                className="flex-1 flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors text-left"
              >
                <span className="text-gray-400">
                  {expanded === t.tenant_id
                    ? <ChevronDown className="w-4 h-4" />
                    : <ChevronRight className="w-4 h-4" />}
                </span>

                <div className="flex-1 min-w-0">
                  <p className={clsx('font-semibold', t.active ? 'text-gray-900' : 'text-gray-400 line-through')}>{t.tenant_name}</p>
                  <p className="text-xs text-gray-400">{t.slug}</p>
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <span title="Hosts">{t.host_count} Hosts</span>
                  <span title="Services">{t.service_count} Checks</span>
                </div>

                <div className="flex items-center gap-2">
                  {!t.active ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-gray-200 text-gray-500">
                      INAKTIV
                    </span>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </button>
              <div className="flex items-center gap-1.5 mr-4">
                <button
                  onClick={(e) => { e.stopPropagation(); setCopyTarget({ id: t.tenant_id, name: t.tenant_name }); setCopyName(''); setCopySlug(''); setCopyError(null) }}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-300 transition-colors"
                  title="Tenant kopieren"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleActiveMutation.mutate({ id: t.tenant_id, active: !t.active }) }}
                  className={clsx(
                    'p-1.5 rounded-lg border transition-colors',
                    t.active
                      ? 'border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300'
                      : 'border-emerald-300 text-emerald-500 hover:bg-emerald-50',
                  )}
                  title={t.active ? 'Deaktivieren' : 'Aktivieren'}
                >
                  <Power className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: t.tenant_id, name: t.tenant_name }) }}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors"
                  title="Tenant endgültig löschen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Expanded detail */}
            {expanded === t.tenant_id && (
              <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 grid grid-cols-2 gap-6">
                {/* Collectors */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-gray-400" />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Collectors</p>
                    </div>
                    <button
                      onClick={() => setCollectorTarget({ id: t.tenant_id, name: t.tenant_name })}
                      className="flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium"
                    >
                      <Plus className="w-3 h-3" /> Anlegen
                    </button>
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
                                zuletzt: {formatDateTime(c.last_seen_at)}
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
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-gray-400" />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API Keys</p>
                    </div>
                    <button
                      onClick={() => setKeyTarget({ id: t.tenant_id, name: t.tenant_name })}
                      className="flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium"
                    >
                      <Plus className="w-3 h-3" /> Generieren
                    </button>
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
                                ? `zuletzt: ${formatDateTime(k.last_used_at)}`
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
