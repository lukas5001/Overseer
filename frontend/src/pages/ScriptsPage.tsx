import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileCode2, Plus, X, Trash2, Pencil, Copy } from 'lucide-react'
import { api } from '../api/client'
import type { MonitoringScript, MonitoringScriptCreate, Tenant } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'

const INTERPRETERS = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'bash', label: 'Bash' },
  { value: 'python', label: 'Python' },
]

const OUTPUT_FORMATS = [
  { value: 'nagios', label: 'Nagios (Exit-Code + Perfdata)' },
  { value: 'text', label: 'Text (Exit-Code)' },
  { value: 'json', label: 'JSON (status/value/message)' },
]

// ── Script Modal ─────────────────────────────────────────────────────────────

function ScriptModal({ onClose, existing, tenants }: {
  onClose: () => void
  existing?: MonitoringScript
  tenants: Tenant[]
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [tenantId, setTenantId] = useState(existing?.tenant_id ?? tenants[0]?.id ?? '')
  const [interpreter, setInterpreter] = useState<string>(existing?.interpreter ?? 'powershell')
  const [expectedOutput, setExpectedOutput] = useState<string>(existing?.expected_output ?? 'nagios')
  const [scriptBody, setScriptBody] = useState(existing?.script_body ?? '')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const body: MonitoringScriptCreate = {
        tenant_id: tenantId,
        name,
        description,
        interpreter,
        script_body: scriptBody,
        expected_output: expectedOutput,
      }
      if (existing) return api.put(`/api/v1/scripts/${existing.id}`, body).then(r => r.data)
      return api.post('/api/v1/scripts/', body).then(r => r.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scripts'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{existing ? 'Script bearbeiten' : 'Neues Script'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="check_backup_status"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            {!existing && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tenant *</label>
                <select value={tenantId} onChange={e => setTenantId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Prüft ob das letzte Backup erfolgreich war"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Interpreter</label>
              <select value={interpreter} onChange={e => setInterpreter(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {INTERPRETERS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Output-Format</label>
              <select value={expectedOutput} onChange={e => setExpectedOutput(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {OUTPUT_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Script *</label>
            <textarea value={scriptBody} onChange={e => setScriptBody(e.target.value)}
              rows={14}
              placeholder={interpreter === 'powershell'
                ? '# Nagios-Format: Exit-Code 0=OK, 1=WARNING, 2=CRITICAL\n$result = Get-Service -Name "MSSQLSERVER"\nif ($result.Status -eq "Running") {\n    Write-Output "OK - SQL Server running | uptime=1"\n    exit 0\n} else {\n    Write-Output "CRITICAL - SQL Server stopped"\n    exit 2\n}'
                : '#!/bin/bash\n# Nagios-Format: Exit-Code 0=OK, 1=WARNING, 2=CRITICAL\necho "OK - check passed | value=42"\nexit 0'}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none font-mono leading-relaxed resize-y" />
          </div>

          {/* Output format hints */}
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
            {expectedOutput === 'nagios' && (
              <><b>Nagios-Format:</b> Exit-Code bestimmt den Status (0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN). Optional Perfdata nach &quot;|&quot;: <code>label=value[unit]</code></>
            )}
            {expectedOutput === 'text' && (
              <><b>Text-Format:</b> Exit-Code 0 = OK, alles andere = CRITICAL. Erste Zahl in der Ausgabe wird als Wert extrahiert.</>
            )}
            {expectedOutput === 'json' && (
              <><b>JSON-Format:</b> Ausgabe muss JSON sein: <code>{`{"status":"OK","value":42.0,"unit":"%","message":"..."}`}</code></>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors">
              Abbrechen
            </button>
            <button onClick={() => mutation.mutate()} disabled={!name || !scriptBody || mutation.isPending}
              className="px-4 py-2 text-sm text-white bg-overseer-600 hover:bg-overseer-700 rounded-lg disabled:opacity-50 transition-colors">
              {mutation.isPending ? 'Speichern...' : (existing ? 'Aktualisieren' : 'Erstellen')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ScriptsPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<MonitoringScript | undefined>()
  const [deleting, setDeleting] = useState<MonitoringScript | null>(null)
  const [filterTenant, setFilterTenant] = useState<string>('')
  const [filterInterpreter, setFilterInterpreter] = useState<string>('')

  const { data: scripts = [], isLoading } = useQuery<MonitoringScript[]>({
    queryKey: ['scripts'],
    queryFn: () => api.get('/api/v1/scripts/').then(r => r.data),
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/scripts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scripts'] }); setDeleting(null) },
  })

  const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]))

  const filtered = scripts.filter(s => {
    if (filterTenant && s.tenant_id !== filterTenant) return false
    if (filterInterpreter && s.interpreter !== filterInterpreter) return false
    return true
  })

  const interpreterBadge = (i: string) => {
    const colors: Record<string, string> = {
      powershell: 'bg-blue-100 text-blue-700',
      bash: 'bg-green-100 text-green-700',
      python: 'bg-yellow-100 text-yellow-700',
    }
    return colors[i] ?? 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileCode2 className="w-6 h-6 text-overseer-500" />
          <h1 className="text-2xl font-bold text-gray-900">Monitoring Scripts</h1>
          <span className="text-sm text-gray-500">{filtered.length} Scripts</span>
        </div>
        <button onClick={() => { setEditing(undefined); setShowModal(true) }}
          className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-overseer-600 hover:bg-overseer-700 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Neues Script
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
          <option value="">Alle Tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filterInterpreter} onChange={e => setFilterInterpreter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
          <option value="">Alle Interpreter</option>
          {INTERPRETERS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Lade Scripts...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileCode2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Noch keine Scripts angelegt.</p>
          <p className="text-sm mt-1">Scripts werden zentral verwaltet und vom Agent auf den Zielrechnern ausgeführt.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Beschreibung</th>
                <th className="px-4 py-3">Interpreter</th>
                <th className="px-4 py-3">Output</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{s.description || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${interpreterBadge(s.interpreter)}`}>
                      {s.interpreter}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.expected_output}</td>
                  <td className="px-4 py-3 text-gray-500">{tenantMap[s.tenant_id] ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => navigator.clipboard.writeText(s.id)}
                        title="ID kopieren"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={() => { setEditing(s); setShowModal(true) }}
                        title="Bearbeiten"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-overseer-600 hover:bg-gray-100 transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleting(s)}
                        title="Löschen"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-100 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showModal && <ScriptModal onClose={() => setShowModal(false)} existing={editing} tenants={tenants} />}
      {deleting && (
        <ConfirmDialog
          open={true}
          title="Script löschen"
          message={`Möchten Sie das Script "${deleting.name}" wirklich löschen? Es wird aus allen zugewiesenen Checks entfernt.`}
          onConfirm={() => deleteMut.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
          confirmLabel="Löschen"
          variant="danger"
        />
      )}
    </div>
  )
}
