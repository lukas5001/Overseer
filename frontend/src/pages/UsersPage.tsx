import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, X, Trash2, Key } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { formatDateTime } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'

interface UserItem {
  id: string
  email: string
  display_name: string
  role: string
  tenant_access: string
  tenant_ids: string[]
  active: boolean
  last_login_at: string | null
  created_at: string
}

const ROLES = ['super_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer']

const roleBadge: Record<string, string> = {
  super_admin: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300',
  tenant_admin: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  tenant_operator: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  tenant_viewer: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
}

// ── Add User Modal ─────────────────────────────────────────────────────────────

interface AddUserModalProps {
  onClose: () => void
  onSaved: () => void
}

function AddUserModal({ onClose, onSaved }: AddUserModalProps) {
  const [form, setForm] = useState({ email: '', password: '', display_name: '', role: 'tenant_viewer', tenant_access: 'selected' })
  const [selectedTenants, setSelectedTenants] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/users/', {
      email: form.email,
      password: form.password,
      display_name: form.display_name,
      role: form.role,
      tenant_access: form.tenant_access,
      tenant_ids: form.tenant_access === 'all' ? [] : selectedTenants,
    }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const toggleTenant = (id: string) =>
    setSelectedTenants(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Benutzer anlegen</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">E-Mail *</label>
            <input value={form.email} onChange={set('email')} type="email" placeholder="max@example.com"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Anzeigename *</label>
            <input value={form.display_name} onChange={set('display_name')} placeholder="Max Mustermann"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Passwort *</label>
            <input value={form.password} onChange={set('password')} type="password"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Rolle</label>
              <select value={form.role} onChange={set('role')}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tenant-Zugriff</label>
              <select value={form.tenant_access} onChange={set('tenant_access')}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                <option value="all">Alle Tenants</option>
                <option value="selected">Ausgewählte Tenants</option>
              </select>
            </div>
          </div>

          {form.tenant_access === 'selected' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tenants auswählen</label>
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg max-h-32 overflow-y-auto p-2 space-y-1">
                {tenants.map(t => (
                  <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedTenants.includes(t.id)}
                      onChange={() => toggleTenant(t.id)}
                      className="rounded border-gray-300 dark:border-gray-600 text-overseer-600 focus:ring-overseer-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{t.name}</span>
                  </label>
                ))}
                {tenants.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 px-2">Keine Tenants vorhanden</p>}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.email || !form.password || !form.display_name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Benutzer anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Set Password Modal ─────────────────────────────────────────────────────────

interface SetPasswordModalProps {
  userId: string
  email: string
  onClose: () => void
}

function SetPasswordModal({ userId, email, onClose }: SetPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/v1/users/${userId}/password`, { password }),
    onSuccess: () => setDone(true),
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Passwort setzen</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{email}</p>
        {done ? (
          <>
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">Passwort gesetzt.</p>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium">Schließen</button>
          </>
        ) : (
          <>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password"
              placeholder="Neues Passwort"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none mb-3" />
            {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 mb-3">{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Abbrechen</button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !password}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {mutation.isPending ? '…' : 'Setzen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [pwTarget, setPwTarget] = useState<{ id: string; email: string } | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: string; email: string } | null>(null)

  const { data: users = [], isLoading } = useQuery<UserItem[]>({
    queryKey: ['users-list'],
    queryFn: () => api.get('/api/v1/users/').then(r => r.data),
  })

  const { data: tenantsList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const tenantNames: Record<string, string> = {}
  tenantsList.forEach(t => { tenantNames[t.id] = t.name })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/users/${id}`),
    onSuccess: () => { setDeactivateTarget(null); queryClient.invalidateQueries({ queryKey: ['users-list'] }) },
  })

  const roleChangeMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(`/api/v1/users/${id}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users-list'] }),
  })

  return (
    <div className="p-8">
      {showAdd && (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['users-list'] })}
        />
      )}
      {pwTarget && (
        <SetPasswordModal
          userId={pwTarget.id}
          email={pwTarget.email}
          onClose={() => setPwTarget(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Benutzer</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{users.length}</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700"
        >
          <Plus className="w-4 h-4" />
          Benutzer anlegen
        </button>
      </div>

      {isLoading && <div className="text-gray-400 dark:text-gray-500 text-sm">Lade…</div>}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
            <tr>
              <th className="px-6 py-3 text-left">Benutzer</th>
              <th className="px-6 py-3 text-left">Rolle</th>
              <th className="px-6 py-3 text-left">Tenants</th>
              <th className="px-6 py-3 text-left">Letzter Login</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {users.map(u => (
              <tr key={u.id} className={clsx('hover:bg-gray-50 dark:hover:bg-gray-700', !u.active && 'opacity-50')}>
                <td className="px-6 py-3">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{u.display_name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{u.email}</p>
                </td>
                <td className="px-6 py-3">
                  <select
                    value={u.role}
                    onChange={e => roleChangeMutation.mutate({ id: u.id, role: e.target.value })}
                    className={clsx(
                      'text-xs font-semibold px-2 py-0.5 rounded border-0 outline-none cursor-pointer',
                      roleBadge[u.role] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                    )}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">
                  {u.tenant_access === 'all' ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">Alle</span>
                  ) : u.tenant_ids.length > 0 ? (
                    <span title={u.tenant_ids.map(id => tenantNames[id] || id).join(', ')}>
                      {u.tenant_ids.slice(0, 2).map(id => tenantNames[id] || id.slice(0, 8)).join(', ')}
                      {u.tenant_ids.length > 2 && ` +${u.tenant_ids.length - 2}`}
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">–</span>
                  )}
                </td>
                <td className="px-6 py-3 text-gray-400 dark:text-gray-500 text-xs">
                  {u.last_login_at ? formatDateTime(u.last_login_at) : 'noch nie'}
                </td>
                <td className="px-6 py-3">
                  <span className={clsx(
                    'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                    u.active ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
                  )}>
                    {u.active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setPwTarget({ id: u.id, email: u.email })}
                      title="Passwort setzen"
                      className="text-gray-300 dark:text-gray-600 hover:text-overseer-500 transition-colors"
                    >
                      <Key className="w-3.5 h-3.5" />
                    </button>
                    {u.active && (
                      <button
                        onClick={() => setDeactivateTarget({ id: u.id, email: u.email })}
                        title="Deaktivieren"
                        className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Benutzer deaktivieren"
        message={`Benutzer ${deactivateTarget?.email} wirklich deaktivieren?`}
        confirmLabel="Deaktivieren"
        variant="warning"
        loading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  )
}
