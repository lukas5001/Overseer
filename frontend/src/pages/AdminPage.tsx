import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Activity, Users, Download, Upload, FileText,
  Plus, X, Check, AlertCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { api } from '../api/client'
import type { User, AuditLog, UserRole } from '../types'

type Tab = 'system' | 'users' | 'backup' | 'audit'

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
        <div key={c.label} className={clsx('rounded-xl p-5 border', c.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
          <p className="text-xs font-medium text-gray-500 uppercase">{c.label}</p>
          <div className="flex items-center gap-2 mt-2">
            {c.ok ? <Check className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
            <span className={clsx('text-lg font-bold', c.ok ? 'text-emerald-700' : 'text-red-700')}>{c.value}</span>
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? <div className="p-8 text-center text-gray-400">Lade…</div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">E-Mail</th>
                <th className="px-6 py-3 text-left">Name</th>
                <th className="px-6 py-3 text-left">Rolle</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{u.email}</td>
                  <td className="px-6 py-3 text-gray-500">{u.display_name ?? '–'}</td>
                  <td className="px-6 py-3">
                    <select value={u.role} onChange={e => updateRole.mutate({ id: u.id, role: e.target.value })}
                      className="text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-overseer-500">
                      {roles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium',
                      u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                      {u.active ? 'Aktiv' : 'Deaktiviert'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
                      className={clsx('text-xs px-3 py-1 rounded border', u.active ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50')}>
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Neuer User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Passwort</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rolle</label>
            <select value={role} onChange={e => setRole(e.target.value as UserRole)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
              <option value="super_admin">Super Admin</option>
              <option value="tenant_admin">Tenant Admin</option>
              <option value="tenant_operator">Operator</option>
              <option value="tenant_viewer">Viewer</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
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
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Export</h3>
        <p className="text-sm text-gray-500 mb-3">Exportiert alle Konfiguration (ohne Secrets und Check-Results) als JSON.</p>
        <button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700 disabled:opacity-60">
          <Download className="w-4 h-4" /> {exportMutation.isPending ? 'Exportieren…' : 'Export JSON'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Import</h3>
        <p className="text-sm text-gray-500 mb-3">Importiert Konfiguration aus einer Export-Datei.</p>
        <input type="file" ref={fileRef} accept=".json" onChange={handleFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={importMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-60">
          <Upload className="w-4 h-4" /> {importMutation.isPending ? 'Importieren…' : 'Import JSON'}
        </button>
        {importResult && (
          <pre className="mt-3 text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-48">{importResult}</pre>
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {isLoading ? <div className="p-8 text-center text-gray-400">Lade…</div> : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Zeitpunkt</th>
              <th className="px-6 py-3 text-left">User</th>
              <th className="px-6 py-3 text-left">Aktion</th>
              <th className="px-6 py-3 text-left">Ziel</th>
              <th className="px-6 py-3 text-left">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss')}
                </td>
                <td className="px-6 py-3 text-gray-700 text-xs">{log.actor_email ?? '–'}</td>
                <td className="px-6 py-3">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium text-gray-700">{log.action}</span>
                </td>
                <td className="px-6 py-3 text-xs text-gray-500">{log.target_type ?? '–'}</td>
                <td className="px-6 py-3 text-xs text-gray-400 max-w-xs truncate">
                  {log.detail ? JSON.stringify(log.detail).slice(0, 80) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {logs.length === 0 && !isLoading && (
        <div className="p-8 text-center text-gray-400 text-sm">Keine Audit-Einträge.</div>
      )}
      {logs.length >= limit && (
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={() => setOffset(prev => prev + limit)}
            className="text-xs text-overseer-600 hover:text-overseer-700 font-medium">
            Nächste Seite
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('system')

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'system', label: 'System', icon: Activity },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'backup', label: 'Backup', icon: Download },
    { key: 'audit', label: 'Audit-Log', icon: FileText },
  ]

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <ShieldAlert className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={clsx('flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key ? 'border-overseer-600 text-overseer-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'system' && <SystemTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'backup' && <BackupTab />}
      {activeTab === 'audit' && <AuditTab />}
    </div>
  )
}
