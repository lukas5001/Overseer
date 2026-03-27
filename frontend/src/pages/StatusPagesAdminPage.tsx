import { useState } from 'react'
import {
  useStatusPages, useStatusPage, useCreateStatusPage, useUpdateStatusPage, useDeleteStatusPage,
  useStatusPageIncidents, useCreateIncident, useAddIncidentUpdate,
  useAddComponent, useUpdateComponent, useDeleteComponent,
  useCreateMaintenance, useStatusPageSubscribers, useDeleteSubscriber,
  useHosts, useServices,
} from '../api/hooks'
import type { StatusPage, StatusPageComponent } from '../types'
import {
  Plus, Trash2, ExternalLink, Pencil, ChevronRight, AlertTriangle, CheckCircle,
  XCircle, MinusCircle, Copy, Wrench, Mail, Clock,
} from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  operational: 'bg-green-500',
  degraded_performance: 'bg-yellow-500',
  partial_outage: 'bg-orange-500',
  major_outage: 'bg-red-500',
  under_maintenance: 'bg-blue-500',
}

const STATUS_LABELS: Record<string, string> = {
  operational: 'Operational',
  degraded_performance: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  under_maintenance: 'Under Maintenance',
}

const INCIDENT_STATUS_OPTS = ['investigating', 'identified', 'monitoring', 'resolved']
const IMPACT_OPTS = ['minor', 'major', 'critical']

export default function StatusPagesAdminPage() {
  const { data: pages, isLoading } = useStatusPages()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  if (selectedId) {
    return <StatusPageDetail pageId={selectedId} onBack={() => setSelectedId(null)} />
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Status Pages</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <Plus className="w-4 h-4" /> Neue Status Page
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-400">Laden...</div>
      ) : !pages?.length ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">Keine Status Pages vorhanden</p>
          <p className="text-sm">Erstelle eine Status Page um den öffentlichen Status deiner Services anzuzeigen.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {pages.map(page => (
            <PageCard key={page.id} page={page} onSelect={() => setSelectedId(page.id)} />
          ))}
        </div>
      )}

      {showCreate && <CreatePageDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function PageCard({ page, onSelect }: { page: StatusPage; onSelect: () => void }) {
  const deleteMut = useDeleteStatusPage()
  const origin = window.location.origin

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 flex items-center justify-between">
      <div className="flex items-center gap-4 cursor-pointer" onClick={onSelect}>
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: page.primary_color }} />
        <div>
          <h3 className="font-semibold text-lg">{page.title}</h3>
          <p className="text-sm text-gray-500">
            /{page.slug} &middot; {page.component_count ?? 0} Komponenten &middot; {page.is_public ? 'Öffentlich' : 'Privat'}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400" />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigator.clipboard.writeText(`${origin}/status/${page.slug}`)}
          className="p-2 text-gray-400 hover:text-blue-500" title="Link kopieren"
        >
          <Copy className="w-4 h-4" />
        </button>
        <a href={`/status/${page.slug}`} target="_blank" rel="noopener noreferrer"
          className="p-2 text-gray-400 hover:text-blue-500" title="Öffnen"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <button
          onClick={() => { if (confirm('Status Page löschen?')) deleteMut.mutate(page.id) }}
          className="p-2 text-gray-400 hover:text-red-500" title="Löschen"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function CreatePageDialog({ onClose }: { onClose: () => void }) {
  const createMut = useCreateStatusPage()
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [color, setColor] = useState('#22c55e')
  const [tz, setTz] = useState('Europe/Rome')

  const handleSubmit = () => {
    if (!slug || !title) return
    createMut.mutate({ slug, title, primary_color: color, timezone: tz }, {
      onSuccess: () => onClose(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold">Neue Status Page</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Titel</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Slug (URL-Pfad)</label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="z.B. mueller-gmbh" className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
          <p className="text-xs text-gray-500 mt-1">/status/{slug || '...'}</p>
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Primärfarbe</label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-full rounded border dark:border-gray-600 cursor-pointer" />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Zeitzone</label>
            <input value={tz} onChange={e => setTz(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800">Abbrechen</button>
          <button onClick={handleSubmit} disabled={!slug || !title || createMut.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Erstellen
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Detail view for a single status page ────────────────────────────────────

function StatusPageDetail({ pageId, onBack }: { pageId: string; onBack: () => void }) {
  const { data: page, isLoading } = useStatusPage(pageId)
  const updateMut = useUpdateStatusPage()
  const { data: incidents } = useStatusPageIncidents(pageId)
  const [tab, setTab] = useState<'components' | 'incidents' | 'maintenance' | 'subscribers' | 'settings'>('components')
  const [showAddComp, setShowAddComp] = useState(false)
  const [showAddIncident, setShowAddIncident] = useState(false)
  const [showAddMaint, setShowAddMaint] = useState(false)

  if (isLoading || !page) return <div className="p-6 text-gray-400">Laden...</div>

  const regularIncidents = incidents?.filter(i => i.impact !== 'maintenance') || []
  const maintenanceIncidents = incidents?.filter(i => i.impact === 'maintenance') || []

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-blue-500 hover:text-blue-400">&larr; Zurück</button>
        <h1 className="text-2xl font-bold">{page.title}</h1>
        <a href={`/status/${page.slug}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500">
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
        {(['components', 'incidents', 'maintenance', 'subscribers', 'settings'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-white dark:bg-gray-700 shadow' : 'text-gray-500 hover:text-gray-700'}`}>
            {{ components: 'Komponenten', incidents: 'Incidents', maintenance: 'Wartung', subscribers: 'Subscriber', settings: 'Einstellungen' }[t]}
          </button>
        ))}
      </div>

      {tab === 'components' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAddComp(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Komponente
            </button>
          </div>
          {page.components?.length ? (
            <div className="space-y-3">
              {page.components.map(comp => (
                <ComponentRow key={comp.id} pageId={pageId} component={comp} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Keine Komponenten. Füge Komponenten hinzu und verknüpfe sie mit Checks.</p>
          )}
          {showAddComp && <AddComponentDialog pageId={pageId} onClose={() => setShowAddComp(false)} />}
        </div>
      )}

      {tab === 'incidents' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAddIncident(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Incident erstellen
            </button>
          </div>
          {regularIncidents.length ? (
            <div className="space-y-3">
              {regularIncidents.map(inc => (
                <IncidentRow key={inc.id} pageId={pageId} incident={inc} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Keine Incidents.</p>
          )}
          {showAddIncident && <CreateIncidentDialog pageId={pageId} components={page.components || []} onClose={() => setShowAddIncident(false)} />}
        </div>
      )}

      {tab === 'maintenance' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAddMaint(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Wartung planen
            </button>
          </div>
          {maintenanceIncidents.length ? (
            <div className="space-y-3">
              {maintenanceIncidents.map(inc => (
                <MaintenanceRow key={inc.id} pageId={pageId} incident={inc} />
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">Keine geplanten Wartungen.</p>
          )}
          {showAddMaint && <CreateMaintenanceDialog pageId={pageId} components={page.components || []} onClose={() => setShowAddMaint(false)} />}
        </div>
      )}

      {tab === 'subscribers' && (
        <SubscribersTab pageId={pageId} />
      )}

      {tab === 'settings' && (
        <SettingsTab page={page} onUpdate={(data) => updateMut.mutate({ id: pageId, data })} />
      )}
    </div>
  )
}


function ComponentRow({ pageId, component: c }: { pageId: string; component: StatusPageComponent }) {
  const deleteMut = useDeleteComponent()
  const [editing, setEditing] = useState(false)

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[c.current_status] || 'bg-gray-400'}`} />
          <div>
            <span className="font-medium">{c.name}</span>
            {c.group_name && <span className="text-xs text-gray-500 ml-2">({c.group_name})</span>}
            <span className="text-xs ml-2 text-gray-400">{STATUS_LABELS[c.current_status] || c.current_status}</span>
            {c.status_override && <span className="text-xs ml-2 text-amber-500">(Override)</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{c.service_ids.length} Checks</span>
          <button onClick={() => setEditing(!editing)} className="p-1 text-gray-400 hover:text-blue-500">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => { if (confirm('Komponente löschen?')) deleteMut.mutate({ pageId, compId: c.id }) }}
            className="p-1 text-gray-400 hover:text-red-500">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {editing && (
        <EditComponentInline pageId={pageId} component={c} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}


function EditComponentInline({ pageId, component: c, onClose }: { pageId: string; component: StatusPageComponent; onClose: () => void }) {
  const updateMut = useUpdateComponent()
  const [name, setName] = useState(c.name)
  const [group, setGroup] = useState(c.group_name || '')
  const [override, setOverride] = useState(c.status_override)
  const [manualStatus, setManualStatus] = useState(c.current_status)

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Gruppe</label>
          <input value={group} onChange={e => setGroup(e.target.value)} placeholder="z.B. Infrastructure" className="w-full px-2 py-1.5 text-sm border rounded dark:bg-gray-700 dark:border-gray-600" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
          Status Override (manuell)
        </label>
        {override && (
          <select value={manualStatus} onChange={e => setManualStatus(e.target.value)} className="px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600">
            <option value="operational">Operational</option>
            <option value="degraded_performance">Degraded</option>
            <option value="partial_outage">Partial Outage</option>
            <option value="major_outage">Major Outage</option>
          </select>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500">Abbrechen</button>
        <button
          onClick={() => {
            updateMut.mutate({
              pageId, compId: c.id,
              data: { name, group_name: group || null, status_override: override, ...(override ? { current_status: manualStatus } : {}) },
            }, { onSuccess: onClose })
          }}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Speichern
        </button>
      </div>
    </div>
  )
}


function AddComponentDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const addMut = useAddComponent()
  const { data: hosts } = useHosts()
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [selectedHost, setSelectedHost] = useState('')
  const { data: services } = useServices(selectedHost ? { host_id: selectedHost } : undefined)
  const [selectedServices, setSelectedServices] = useState<string[]>([])

  const toggleService = (sid: string) => {
    setSelectedServices(prev => prev.includes(sid) ? prev.filter(s => s !== sid) : [...prev, sid])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold">Komponente hinzufügen</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Komponentenname (öffentlich sichtbar)</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Website, Email, ERP" className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Gruppe (optional)</label>
          <input value={group} onChange={e => setGroup(e.target.value)} placeholder="z.B. Infrastructure" className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Checks verknüpfen</label>
          <select value={selectedHost} onChange={e => setSelectedHost(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 mb-2">
            <option value="">Host wählen...</option>
            {hosts?.map(h => <option key={h.id} value={h.id}>{h.display_name || h.hostname}</option>)}
          </select>
          {services && services.length > 0 && (
            <div className="border rounded-lg dark:border-gray-600 max-h-48 overflow-y-auto">
              {services.map(s => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm">
                  <input type="checkbox" checked={selectedServices.includes(s.id)} onChange={() => toggleService(s.id)} />
                  {s.name || s.check_type}
                </label>
              ))}
            </div>
          )}
          {selectedServices.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">{selectedServices.length} Check(s) ausgewählt</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800">Abbrechen</button>
          <button
            onClick={() => {
              if (!name) return
              addMut.mutate({ pageId, data: { name, group_name: group || null, service_ids: selectedServices } }, { onSuccess: onClose })
            }}
            disabled={!name || addMut.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Hinzufügen
          </button>
        </div>
      </div>
    </div>
  )
}


function IncidentRow({ pageId, incident: inc }: { pageId: string; incident: { id: string; title: string; status: string; impact: string; is_auto_created: boolean; created_at: string; resolved_at: string | null; updates: { id: string; status: string; body: string; created_at: string }[]; affected_component_ids: string[] } }) {
  const addUpdateMut = useAddIncidentUpdate()
  const [showUpdate, setShowUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(inc.status)
  const [updateBody, setUpdateBody] = useState('')

  const statusIcon = inc.status === 'resolved'
    ? <CheckCircle className="w-4 h-4 text-green-500" />
    : inc.impact === 'critical'
      ? <XCircle className="w-4 h-4 text-red-500" />
      : inc.impact === 'major'
        ? <AlertTriangle className="w-4 h-4 text-orange-500" />
        : <MinusCircle className="w-4 h-4 text-yellow-500" />

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="font-medium">{inc.title}</span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{inc.status}</span>
          {inc.is_auto_created && <span className="text-xs text-gray-400">auto</span>}
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>{new Date(inc.created_at).toLocaleDateString('de')}</span>
          {inc.status !== 'resolved' && (
            <button onClick={() => setShowUpdate(!showUpdate)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300">
              Update
            </button>
          )}
        </div>
      </div>

      {/* Updates timeline */}
      {inc.updates.length > 0 && (
        <div className="ml-6 border-l-2 border-gray-200 dark:border-gray-600 pl-4 space-y-2">
          {inc.updates.map(u => (
            <div key={u.id} className="text-sm">
              <span className="font-medium capitalize">{u.status}</span>
              <span className="text-gray-400 ml-2">{new Date(u.created_at).toLocaleString('de')}</span>
              <p className="text-gray-600 dark:text-gray-400">{u.body}</p>
            </div>
          ))}
        </div>
      )}

      {showUpdate && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <select value={updateStatus} onChange={e => setUpdateStatus(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm">
            {INCIDENT_STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea value={updateBody} onChange={e => setUpdateBody(e.target.value)} rows={2} placeholder="Update-Text..."
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowUpdate(false)} className="px-3 py-1.5 text-sm text-gray-500">Abbrechen</button>
            <button
              onClick={() => {
                addUpdateMut.mutate({ pageId, incidentId: inc.id, data: { status: updateStatus, body: updateBody } }, {
                  onSuccess: () => { setShowUpdate(false); setUpdateBody('') },
                })
              }}
              disabled={!updateBody}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              Senden
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


function CreateIncidentDialog({ pageId, components, onClose }: { pageId: string; components: StatusPageComponent[]; onClose: () => void }) {
  const createMut = useCreateIncident()
  const [title, setTitle] = useState('')
  const [impact, setImpact] = useState('minor')
  const [body, setBody] = useState('')
  const [selectedComps, setSelectedComps] = useState<string[]>([])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold">Incident erstellen</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Titel</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Impact</label>
          <select value={impact} onChange={e => setImpact(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600">
            {IMPACT_OPTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Betroffene Komponenten</label>
          <div className="border rounded-lg dark:border-gray-600 max-h-32 overflow-y-auto">
            {components.map(c => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedComps.includes(c.id)} onChange={() => setSelectedComps(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Beschreibung</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-gray-600">Abbrechen</button>
          <button
            onClick={() => {
              if (!title) return
              createMut.mutate({ pageId, data: { title, impact, body, component_ids: selectedComps, status: 'investigating' } }, { onSuccess: onClose })
            }}
            disabled={!title || createMut.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Erstellen
          </button>
        </div>
      </div>
    </div>
  )
}


function MaintenanceRow({ pageId, incident: inc }: { pageId: string; incident: { id: string; title: string; status: string; scheduled_start: string | null; scheduled_end: string | null; created_at: string; resolved_at: string | null; updates: { id: string; status: string; body: string; created_at: string }[]; affected_component_ids: string[] } }) {
  const addUpdateMut = useAddIncidentUpdate()
  const [showUpdate, setShowUpdate] = useState(false)
  const [updateBody, setUpdateBody] = useState('')

  const statusColor = inc.status === 'resolved' ? 'text-green-500' : inc.status === 'in_progress' ? 'text-blue-500' : 'text-gray-500'

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString('de', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-blue-500" />
          <span className="font-medium">{inc.title}</span>
          <span className={`text-xs px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 ${statusColor}`}>{inc.status}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {inc.status !== 'resolved' && (
            <button onClick={() => setShowUpdate(!showUpdate)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300">
              Update
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {fmtDate(inc.scheduled_start)} — {fmtDate(inc.scheduled_end)}</span>
      </div>

      {inc.updates.length > 0 && (
        <div className="ml-6 border-l-2 border-blue-200 dark:border-blue-800 pl-4 space-y-2">
          {inc.updates.map(u => (
            <div key={u.id} className="text-sm">
              <span className="font-medium capitalize">{u.status}</span>
              <span className="text-gray-400 ml-2">{new Date(u.created_at).toLocaleString('de')}</span>
              <p className="text-gray-600 dark:text-gray-400">{u.body}</p>
            </div>
          ))}
        </div>
      )}

      {showUpdate && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <textarea value={updateBody} onChange={e => setUpdateBody(e.target.value)} rows={2} placeholder="Update-Text..."
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowUpdate(false)} className="px-3 py-1.5 text-sm text-gray-500">Abbrechen</button>
            <button
              onClick={() => {
                addUpdateMut.mutate({ pageId, incidentId: inc.id, data: { status: 'resolved', body: updateBody } }, {
                  onSuccess: () => { setShowUpdate(false); setUpdateBody('') },
                })
              }}
              disabled={!updateBody}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              Abschließen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


function CreateMaintenanceDialog({ pageId, components, onClose }: { pageId: string; components: StatusPageComponent[]; onClose: () => void }) {
  const createMut = useCreateMaintenance()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [selectedComps, setSelectedComps] = useState<string[]>([])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold">Wartung planen</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Titel</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Server-Update"
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Beginn</label>
            <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Ende</label>
            <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Betroffene Komponenten</label>
          <div className="border rounded-lg dark:border-gray-600 max-h-32 overflow-y-auto">
            {components.map(c => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedComps.includes(c.id)} onChange={() => setSelectedComps(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Beschreibung</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={2}
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-gray-600">Abbrechen</button>
          <button
            onClick={() => {
              if (!title || !start || !end) return
              createMut.mutate({ pageId, data: {
                title, body,
                component_ids: selectedComps,
                scheduled_start: new Date(start).toISOString(),
                scheduled_end: new Date(end).toISOString(),
              } }, { onSuccess: onClose })
            }}
            disabled={!title || !start || !end || createMut.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Planen
          </button>
        </div>
      </div>
    </div>
  )
}


function SubscribersTab({ pageId }: { pageId: string }) {
  const { data: subscribers, isLoading } = useStatusPageSubscribers(pageId)
  const deleteMut = useDeleteSubscriber()

  if (isLoading) return <div className="text-gray-400">Laden...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Mail className="w-4 h-4" />
        <span>{subscribers?.length || 0} Subscriber ({subscribers?.filter(s => s.confirmed).length || 0} bestätigt)</span>
      </div>
      {subscribers?.length ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
          {subscribers.map(sub => (
            <div key={sub.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{sub.email}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${sub.confirmed ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                  {sub.confirmed ? 'Bestätigt' : 'Ausstehend'}
                </span>
                {sub.component_ids.length > 0 && (
                  <span className="ml-2 text-xs text-gray-400">{sub.component_ids.length} Komponenten</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>{new Date(sub.created_at).toLocaleDateString('de')}</span>
                <button
                  onClick={() => { if (confirm('Subscriber entfernen?')) deleteMut.mutate({ pageId, subId: sub.id }) }}
                  className="p-1 text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-center py-8">Keine Subscriber. Besucher können sich auf der öffentlichen Status Page anmelden.</p>
      )}
    </div>
  )
}


function SettingsTab({ page, onUpdate }: { page: StatusPage; onUpdate: (data: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(page.title)
  const [desc, setDesc] = useState(page.description || '')
  const [color, setColor] = useState(page.primary_color)
  const [tz, setTz] = useState(page.timezone)
  const [isPublic, setIsPublic] = useState(page.is_public)

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-4 max-w-lg">
      <div>
        <label className="block text-sm font-medium mb-1">Titel</label>
        <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Beschreibung</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Primärfarbe</label>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-full rounded border dark:border-gray-600 cursor-pointer" />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Zeitzone</label>
          <input value={tz} onChange={e => setTz(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
        Öffentlich zugänglich
      </label>
      <button
        onClick={() => onUpdate({ title, description: desc || null, primary_color: color, timezone: tz, is_public: isPublic })}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        Speichern
      </button>
    </div>
  )
}
