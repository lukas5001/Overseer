import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Trash2, Pencil, Lock } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { getHostTypeIcon, AVAILABLE_ICONS } from '../lib/constants'
import type { HostTypeConfig } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'

interface TypeForm {
  name: string
  icon: string
  category: string
  agent_capable: boolean
  snmp_enabled: boolean
  ip_required: boolean
  os_family: string
  sort_order: number
}

function emptyForm(): TypeForm {
  return {
    name: '',
    icon: 'server',
    category: 'Sonstiges',
    agent_capable: false,
    snmp_enabled: false,
    ip_required: false,
    os_family: '',
    sort_order: 100,
  }
}

const CATEGORIES = ['Server', 'Netzwerk', 'Peripherie', 'Cloud', 'Sonstiges']

export default function HostTypesPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<TypeForm>(emptyForm())
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HostTypeConfig | null>(null)

  const { data: hostTypes = [], isLoading } = useQuery<HostTypeConfig[]>({
    queryKey: ['host-types'],
    queryFn: () => api.get('/api/v1/host-types/').then(r => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editId
        ? api.patch(`/api/v1/host-types/${editId}`, data)
        : api.post('/api/v1/host-types/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-types'] })
      setShowModal(false)
      setEditId(null)
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/host-types/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['host-types'] })
      setDeleteTarget(null)
    },
    onError: (e: any) => {
      setDeleteTarget(null)
      setError(e.response?.data?.detail ?? 'Fehler beim Löschen')
    },
  })

  function openCreate() {
    setForm(emptyForm())
    setEditId(null)
    setError(null)
    setShowModal(true)
  }

  function openEdit(ht: HostTypeConfig) {
    setForm({
      name: ht.name,
      icon: ht.icon,
      category: ht.category,
      agent_capable: ht.agent_capable,
      snmp_enabled: ht.snmp_enabled,
      ip_required: ht.ip_required,
      os_family: ht.os_family ?? '',
      sort_order: ht.sort_order,
    })
    setEditId(ht.id)
    setError(null)
    setShowModal(true)
  }

  function handleSave() {
    const data: Record<string, unknown> = {
      name: form.name,
      icon: form.icon,
      category: form.category,
      agent_capable: form.agent_capable,
      snmp_enabled: form.snmp_enabled,
      ip_required: form.ip_required,
      os_family: form.os_family || null,
      sort_order: form.sort_order,
    }
    saveMutation.mutate(data)
  }

  // Group by category
  const grouped = hostTypes.reduce<Record<string, HostTypeConfig[]>>((acc, ht) => {
    const cat = ht.category || 'Sonstiges'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(ht)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Host-Typen</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Definiere Typen für Hosts und steuere welche Formfelder und Funktionen verfügbar sind.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700"
        >
          <Plus className="w-4 h-4" /> Neuer Typ
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">Laden...</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, types]) => (
            <div key={category}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">{category}</h2>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {types.map(ht => {
                  const Icon = getHostTypeIcon(ht.icon)
                  return (
                    <div key={ht.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{ht.name}</span>
                          {ht.is_system && (
                            <span title="System-Typ"><Lock className="w-3 h-3 text-gray-400 dark:text-gray-500" /></span>
                          )}
                        </div>
                        <div className="flex gap-2 mt-0.5">
                          {ht.agent_capable && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium">Agent</span>
                          )}
                          {ht.snmp_enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">SNMP</span>
                          )}
                          {ht.ip_required && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">IP Pflicht</span>
                          )}
                          {ht.os_family && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">{ht.os_family}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">#{ht.sort_order}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(ht)}
                          className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Bearbeiten"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {!ht.is_system && (
                          <button
                            onClick={() => setDeleteTarget(ht)}
                            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 rounded-lg hover:bg-red-50"
                            title="Löschen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && !showModal && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Schließen</button>
        </div>
      )}

      {/* ── Create/Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {editId ? 'Host-Typ bearbeiten' : 'Neuer Host-Typ'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="z.B. IP Kamera"
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Kategorie</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_ICONS.map(iconName => {
                    const Ic = getHostTypeIcon(iconName)
                    return (
                      <button
                        key={iconName}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, icon: iconName }))}
                        title={iconName}
                        className={clsx(
                          'w-9 h-9 rounded-lg flex items-center justify-center border transition-colors',
                          form.icon === iconName
                            ? 'border-overseer-500 bg-overseer-50 text-overseer-700'
                            : 'border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                        )}
                      >
                        <Ic className="w-4.5 h-4.5" />
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Capabilities */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-2">Capabilities</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 dark:text-gray-600">
                    <input
                      type="checkbox"
                      checked={form.agent_capable}
                      onChange={e => setForm(f => ({ ...f, agent_capable: e.target.checked }))}
                      className="rounded border-gray-300 dark:border-gray-600 text-overseer-600"
                    />
                    Agent-fähig
                    <span className="text-xs text-gray-400 dark:text-gray-500">— Agent kann installiert werden</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 dark:text-gray-600">
                    <input
                      type="checkbox"
                      checked={form.snmp_enabled}
                      onChange={e => setForm(f => ({ ...f, snmp_enabled: e.target.checked }))}
                      className="rounded border-gray-300 dark:border-gray-600 text-overseer-600"
                    />
                    SNMP-Felder
                    <span className="text-xs text-gray-400 dark:text-gray-500">— Community + Version anzeigen</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 dark:text-gray-600">
                    <input
                      type="checkbox"
                      checked={form.ip_required}
                      onChange={e => setForm(f => ({ ...f, ip_required: e.target.checked }))}
                      className="rounded border-gray-300 dark:border-gray-600 text-overseer-600"
                    />
                    IP-Adresse Pflicht
                    <span className="text-xs text-gray-400 dark:text-gray-500">— IP ist Pflichtfeld beim Anlegen</span>
                  </label>
                </div>
              </div>

              {/* OS Family + Sort */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">OS-Familie</label>
                  <select
                    value={form.os_family}
                    onChange={e => setForm(f => ({ ...f, os_family: e.target.value }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                  >
                    <option value="">– keine –</option>
                    <option value="linux">Linux</option>
                    <option value="windows">Windows</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sortierung</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                    className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending || !form.name}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Speichern...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Host-Typ löschen"
        message={`Soll der Typ "${deleteTarget?.name}" gelöscht werden? Dies geht nur wenn kein Host diesen Typ verwendet.`}
        confirmLabel="Löschen"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
