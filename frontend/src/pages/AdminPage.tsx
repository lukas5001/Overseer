import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Activity, Users, Download, Upload, FileText,
  Plus, X, Check, AlertCircle, KeyRound, Trash2, Pencil,
} from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { api } from '../api/client'
import type { User, AuditLog, UserRole, Tenant } from '../types'

type Tab = 'system' | 'users' | 'sso' | 'backup' | 'audit'

// ── System Tab ───────────────────────────────────────────────────────────────

function SystemTab() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then(r => r.data).catch(() => ({ status: 'error' })),
    refetchInterval: 30_000,
  })

  const cards = [
    { label: 'API', value: health?.status === 'ok' ? 'OK' : 'Error', ok: health?.status === 'ok' },
    { label: 'Datenbank', value: health?.database ?? '–', ok: health?.database === 'ok' },
    { label: 'Redis', value: health?.redis ?? '–', ok: health?.redis === 'ok' },
  ]

  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map(c => (
        <div key={c.label} className={clsx('rounded-xl p-5 border', c.ok ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800')}>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{c.label}</p>
          <div className="flex items-center gap-2 mt-2">
            {c.ok ? <Check className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
            <span className={clsx('text-lg font-bold', c.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300')}>{c.value}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users/').then(r => r.data).catch(() => []),
  })

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/api/v1/users/${id}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/v1/users/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const roles: UserRole[] = ['super_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer']

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer User
        </button>
      </div>

      {showModal && <NewUserModal onClose={() => setShowModal(false)} />}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400 dark:text-gray-500">Lade…</div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">E-Mail</th>
                <th className="px-6 py-3 text-left">Name</th>
                <th className="px-6 py-3 text-left">Rolle</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{u.email}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{u.display_name ?? '–'}</td>
                  <td className="px-6 py-3">
                    <select value={u.role} onChange={e => updateRole.mutate({ id: u.id, role: e.target.value })}
                      className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-overseer-500">
                      {roles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium',
                      u.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300')}>
                      {u.active ? 'Aktiv' : 'Deaktiviert'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
                      className={clsx('text-xs px-3 py-1 rounded border', u.active ? 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30' : 'border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30')}>
                      {u.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function NewUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('tenant_viewer')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/users/', { email, password, role }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Neuer User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">E-Mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Passwort</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Rolle</label>
            <select value={role} onChange={e => setRole(e.target.value as UserRole)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
              <option value="super_admin">Super Admin</option>
              <option value="tenant_admin">Tenant Admin</option>
              <option value="tenant_operator">Operator</option>
              <option value="tenant_viewer">Viewer</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !email || !password}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Erstellen…' : 'User erstellen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Backup Tab ───────────────────────────────────────────────────────────────

function BackupTab() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<string | null>(null)

  const exportMutation = useMutation({
    mutationFn: () => api.get('/api/v1/admin/export').then(r => r.data),
    onSuccess: (data: any) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `overseer-export-${format(new Date(), 'yyyy-MM-dd')}.json`
      a.click()
    },
  })

  const importMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/api/v1/admin/import', data).then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries()
      setImportResult(JSON.stringify(data, null, 2))
    },
    onError: (e: any) => setImportResult(`Fehler: ${e.response?.data?.detail ?? e.message}`),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        importMutation.mutate(data)
      } catch {
        setImportResult('Fehler: Ungültige JSON-Datei')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Export</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Exportiert alle Konfiguration (ohne Secrets und Check-Results) als JSON.</p>
        <button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
          <Download className="w-4 h-4" /> {exportMutation.isPending ? 'Exportieren…' : 'Export JSON'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4">Import</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Importiert Konfiguration aus einer Export-Datei.</p>
        <input type="file" ref={fileRef} accept=".json" onChange={handleFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={importMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60">
          <Upload className="w-4 h-4" /> {importMutation.isPending ? 'Importieren…' : 'Import JSON'}
        </button>
        {importResult && (
          <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded-lg overflow-auto max-h-48">{importResult}</pre>
        )}
      </div>
    </div>
  )
}

// ── Audit Tab ────────────────────────────────────────────────────────────────

function AuditTab() {
  const [limit] = useState(50)
  const [offset, setOffset] = useState(0)

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', { limit, offset }],
    queryFn: () => api.get('/api/v1/audit/', { params: { limit, offset } }).then(r => r.data).catch(() => []),
    refetchInterval: false,
  })

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {isLoading ? <div className="p-8 text-center text-gray-400 dark:text-gray-500">Lade…</div> : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Zeitpunkt</th>
              <th className="px-6 py-3 text-left">User</th>
              <th className="px-6 py-3 text-left">Aktion</th>
              <th className="px-6 py-3 text-left">Ziel</th>
              <th className="px-6 py-3 text-left">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss')}
                </td>
                <td className="px-6 py-3 text-gray-700 dark:text-gray-300 text-xs">{log.actor_email ?? '–'}</td>
                <td className="px-6 py-3">
                  <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs font-medium text-gray-700 dark:text-gray-300">{log.action}</span>
                </td>
                <td className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">{log.target_type ?? '–'}</td>
                <td className="px-6 py-3 text-xs text-gray-400 dark:text-gray-500 max-w-xs truncate">
                  {log.detail ? JSON.stringify(log.detail).slice(0, 80) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {logs.length === 0 && !isLoading && (
        <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Keine Audit-Einträge.</div>
      )}
      {logs.length >= limit && (
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button onClick={() => setOffset(prev => prev + limit)}
            className="text-xs text-overseer-600 hover:text-overseer-700 font-medium">
            Nächste Seite
          </button>
        </div>
      )}
    </div>
  )
}

// ── SSO Tab ─────────────────────────────────────────────────────────────────

interface IdpConfig {
  id: string
  tenant_id: string
  name: string
  auth_type: 'oidc' | 'saml' | 'ldap'
  email_domains: string[]
  oidc_discovery_url?: string
  oidc_client_id?: string
  saml_metadata_url?: string
  saml_entity_id?: string
  ldap_url?: string
  ldap_base_dn?: string
  ldap_bind_dn?: string
  ldap_user_filter?: string
  ldap_group_attribute?: string
  role_mapping?: Record<string, string>
  jit_provisioning: boolean
  allow_password_fallback: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

function SsoTab() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<IdpConfig | null>(null)

  const { data: configs = [], isLoading } = useQuery<IdpConfig[]>({
    queryKey: ['idp-configs'],
    queryFn: () => api.get('/api/v1/sso/idp-configs').then(r => r.data).catch(() => []),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/sso/idp-configs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['idp-configs'] }),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/api/v1/sso/idp-configs/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['idp-configs'] }),
  })

  const authTypeLabel: Record<string, string> = { oidc: 'OIDC', saml: 'SAML', ldap: 'LDAP' }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Identity Provider Konfigurationen für SSO</p>
        <button onClick={() => { setEditing(null); setShowModal(true) }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer IdP
        </button>
      </div>

      {showModal && <IdpModal config={editing} onClose={() => { setShowModal(false); setEditing(null) }} />}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400 dark:text-gray-500">Lade…</div> : configs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Keine IdP-Konfigurationen vorhanden.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Name</th>
                <th className="px-6 py-3 text-left">Typ</th>
                <th className="px-6 py-3 text-left">E-Mail-Domains</th>
                <th className="px-6 py-3 text-center">JIT</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {configs.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                  <td className="px-6 py-3">
                    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium',
                      c.auth_type === 'oidc' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' :
                      c.auth_type === 'saml' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' :
                      'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300')}>
                      {authTypeLabel[c.auth_type] || c.auth_type}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {c.email_domains?.join(', ') || '–'}
                  </td>
                  <td className="px-6 py-3 text-center">
                    {c.jit_provisioning ? <Check className="w-4 h-4 text-emerald-500 mx-auto" /> : <X className="w-4 h-4 text-gray-300 dark:text-gray-600 mx-auto" />}
                  </td>
                  <td className="px-6 py-3 text-center">
                    <button onClick={() => toggleActive.mutate({ id: c.id, is_active: !c.is_active })}
                      className={clsx('px-2 py-0.5 rounded text-xs font-medium cursor-pointer',
                        c.is_active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300')}>
                      {c.is_active ? 'Aktiv' : 'Inaktiv'}
                    </button>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => { setEditing(c); setShowModal(true) }}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-overseer-600" title="Bearbeiten">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => { if (confirm('IdP-Konfiguration löschen?')) deleteMutation.mutate(c.id) }}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600" title="Löschen">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function IdpModal({ config, onClose }: { config: IdpConfig | null; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!config
  const [authType, setAuthType] = useState<string>(config?.auth_type || 'oidc')
  const [name, setName] = useState(config?.name || 'SSO')
  const [tenantId, setTenantId] = useState(config?.tenant_id || '')
  const [emailDomains, setEmailDomains] = useState(config?.email_domains?.join(', ') || '')
  const [jitProvisioning, setJitProvisioning] = useState(config?.jit_provisioning ?? true)
  const [allowPasswordFallback, setAllowPasswordFallback] = useState(config?.allow_password_fallback ?? false)

  // OIDC
  const [oidcDiscoveryUrl, setOidcDiscoveryUrl] = useState(config?.oidc_discovery_url || '')
  const [oidcClientId, setOidcClientId] = useState(config?.oidc_client_id || '')
  const [oidcClientSecret, setOidcClientSecret] = useState('')

  // SAML
  const [samlMetadataUrl, setSamlMetadataUrl] = useState(config?.saml_metadata_url || '')
  const [samlEntityId, setSamlEntityId] = useState(config?.saml_entity_id || '')

  // LDAP
  const [ldapUrl, setLdapUrl] = useState(config?.ldap_url || '')
  const [ldapBaseDn, setLdapBaseDn] = useState(config?.ldap_base_dn || '')
  const [ldapBindDn, setLdapBindDn] = useState(config?.ldap_bind_dn || '')
  const [ldapBindPassword, setLdapBindPassword] = useState('')
  const [ldapUserFilter, setLdapUserFilter] = useState(config?.ldap_user_filter || '(&(objectClass=user)(mail={email}))')
  const [ldapGroupAttribute, setLdapGroupAttribute] = useState(config?.ldap_group_attribute || 'memberOf')

  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data).catch(() => []),
  })

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/v1/sso/idp-configs', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['idp-configs'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/v1/sso/idp-configs/${config!.id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['idp-configs'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const handleSubmit = () => {
    const domains = emailDomains.split(',').map(d => d.trim()).filter(Boolean)
    const body: Record<string, unknown> = {
      name,
      email_domains: domains,
      jit_provisioning: jitProvisioning,
      allow_password_fallback: allowPasswordFallback,
    }

    if (!isEdit) {
      body.tenant_id = tenantId
      body.auth_type = authType
    }

    if (authType === 'oidc') {
      body.oidc_discovery_url = oidcDiscoveryUrl || null
      body.oidc_client_id = oidcClientId || null
      if (oidcClientSecret) body.oidc_client_secret = oidcClientSecret
    } else if (authType === 'saml') {
      body.saml_metadata_url = samlMetadataUrl || null
      body.saml_entity_id = samlEntityId || null
    } else if (authType === 'ldap') {
      body.ldap_url = ldapUrl || null
      body.ldap_base_dn = ldapBaseDn || null
      body.ldap_bind_dn = ldapBindDn || null
      if (ldapBindPassword) body.ldap_bind_password = ldapBindPassword
      body.ldap_user_filter = ldapUserFilter || null
      body.ldap_group_attribute = ldapGroupAttribute || null
    }

    if (isEdit) {
      updateMutation.mutate(body)
    } else {
      createMutation.mutate(body)
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{isEdit ? 'IdP bearbeiten' : 'Neuer IdP'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {!isEdit && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tenant</label>
                <select value={tenantId} onChange={e => setTenantId(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
                  <option value="">– Auswählen –</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Auth-Typ</label>
                <select value={authType} onChange={e => setAuthType(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
                  <option value="oidc">OIDC (OpenID Connect)</option>
                  <option value="saml">SAML 2.0</option>
                  <option value="ldap">LDAP / Active Directory</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">E-Mail-Domains (kommagetrennt)</label>
            <input type="text" value={emailDomains} onChange={e => setEmailDomains(e.target.value)}
              placeholder="example.com, corp.example.com"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* OIDC fields */}
          {authType === 'oidc' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discovery URL</label>
                <input type="url" value={oidcDiscoveryUrl} onChange={e => setOidcDiscoveryUrl(e.target.value)}
                  placeholder="https://login.microsoftonline.com/.../.well-known/openid-configuration"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Client ID</label>
                <input type="text" value={oidcClientId} onChange={e => setOidcClientId(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Client Secret {isEdit && '(leer = unverändert)'}</label>
                <input type="password" value={oidcClientSecret} onChange={e => setOidcClientSecret(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
            </>
          )}

          {/* SAML fields */}
          {authType === 'saml' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Metadata URL</label>
                <input type="url" value={samlMetadataUrl} onChange={e => setSamlMetadataUrl(e.target.value)}
                  placeholder="https://idp.example.com/metadata.xml"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Entity ID (SP)</label>
                <input type="text" value={samlEntityId} onChange={e => setSamlEntityId(e.target.value)}
                  placeholder="https://overseer.dailycrust.it/api/v1/sso/saml/acs"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
            </>
          )}

          {/* LDAP fields */}
          {authType === 'ldap' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">LDAP URL</label>
                <input type="text" value={ldapUrl} onChange={e => setLdapUrl(e.target.value)}
                  placeholder="ldaps://ldap.example.com:636"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Base DN</label>
                <input type="text" value={ldapBaseDn} onChange={e => setLdapBaseDn(e.target.value)}
                  placeholder="DC=example,DC=com"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bind DN (Service Account)</label>
                <input type="text" value={ldapBindDn} onChange={e => setLdapBindDn(e.target.value)}
                  placeholder="CN=svc-overseer,OU=ServiceAccounts,DC=example,DC=com"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Bind Password {isEdit && '(leer = unverändert)'}</label>
                <input type="password" value={ldapBindPassword} onChange={e => setLdapBindPassword(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">User Filter</label>
                <input type="text" value={ldapUserFilter} onChange={e => setLdapUserFilter(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 font-mono text-xs" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Group Attribute</label>
                <input type="text" value={ldapGroupAttribute} onChange={e => setLdapGroupAttribute(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
            </>
          )}

          {/* Common settings */}
          <div className="flex items-center gap-4 pt-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 dark:text-gray-600">
              <input type="checkbox" checked={jitProvisioning} onChange={e => setJitProvisioning(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-overseer-600 focus:ring-overseer-500" />
              JIT-Provisioning
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 dark:text-gray-600">
              <input type="checkbox" checked={allowPasswordFallback} onChange={e => setAllowPasswordFallback(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-overseer-600 focus:ring-overseer-500" />
              Passwort-Fallback
            </label>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Abbrechen</button>
          <button onClick={handleSubmit} disabled={pending || (!isEdit && !tenantId)}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {pending ? 'Speichern…' : isEdit ? 'Speichern' : 'IdP erstellen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('system')

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'system', label: 'System', icon: Activity },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'sso', label: 'SSO', icon: KeyRound },
    { key: 'backup', label: 'Backup', icon: Download },
    { key: 'audit', label: 'Audit-Log', icon: FileText },
  ]

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <ShieldAlert className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Administration</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <div className="flex gap-6">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={clsx('flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key ? 'border-overseer-600 text-overseer-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'system' && <SystemTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'sso' && <SsoTab />}
      {activeTab === 'backup' && <BackupTab />}
      {activeTab === 'audit' && <AuditTab />}
    </div>
  )
}
