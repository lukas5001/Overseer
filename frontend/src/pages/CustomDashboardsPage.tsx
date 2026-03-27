import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Clock, Trash2, Star, LayoutGrid } from 'lucide-react'
import { useDashboards, useCreateDashboard, useDeleteDashboard, useTenants } from '../api/hooks'
import LoadingSpinner from '../components/LoadingSpinner'
import type { DashboardSummary } from '../types'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `vor ${hours}h`
  const days = Math.floor(hours / 24)
  return `vor ${days}d`
}

export default function CustomDashboardsPage() {
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [selectedTenant, setSelectedTenant] = useState('')

  const { data: tenants } = useTenants()
  const tenantId = selectedTenant || tenants?.[0]?.id
  const { data: dashboards, isLoading } = useDashboards(tenantId)
  const createMut = useCreateDashboard()
  const deleteMut = useDeleteDashboard()

  async function handleCreate() {
    if (!newTitle.trim() || !tenantId) return
    try {
      const result = await createMut.mutateAsync({
        tenant_id: tenantId,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
      })
      setShowCreate(false)
      setNewTitle('')
      setNewDesc('')
      navigate(`/custom-dashboards/${result.id}`)
    } catch {
      // error handled by mutation
    }
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (confirm('Dashboard wirklich loschen?')) {
      deleteMut.mutate(id)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-white">Dashboards</h1>
        </div>
        {tenants && tenants.length > 1 && (
          <select
            value={selectedTenant}
            onChange={e => setSelectedTenant(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200"
          >
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {dashboards?.map((d: DashboardSummary) => (
            <div
              key={d.id}
              onClick={() => navigate(`/custom-dashboards/${d.id}`)}
              className="bg-gray-800 border border-gray-700 rounded-xl p-5 cursor-pointer hover:border-blue-500/50 hover:bg-gray-750 transition-all group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-semibold text-white truncate pr-2">{d.title}</h3>
                <div className="flex items-center gap-1">
                  {d.is_default && (
                    <Star className="w-4 h-4 text-amber-400 flex-shrink-0" fill="currentColor" />
                  )}
                  {!d.is_default && (
                    <button
                      onClick={(e) => handleDelete(e, d.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1"
                      title="Loschen"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {d.description && (
                <p className="text-sm text-gray-400 mb-3 line-clamp-2">{d.description}</p>
              )}
              {d.is_default && !d.description && (
                <p className="text-sm text-gray-500 mb-3">Standard-Dashboard</p>
              )}
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5" />
                <span>{timeAgo(d.updated_at)}</span>
              </div>
            </div>
          ))}

          {/* + New Dashboard card */}
          <div
            onClick={() => setShowCreate(true)}
            className="bg-gray-800/50 border-2 border-dashed border-gray-700 rounded-xl p-5 cursor-pointer hover:border-blue-500/50 hover:bg-gray-800 transition-all flex flex-col items-center justify-center min-h-[140px]"
          >
            <Plus className="w-8 h-8 text-gray-500 mb-2" />
            <span className="text-sm text-gray-400 font-medium">Neues Dashboard</span>
          </div>
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Neues Dashboard</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Titel</label>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="z.B. Network Overview"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Beschreibung (optional)</label>
                <input
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Kurze Beschreibung..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || createMut.isPending}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {createMut.isPending ? 'Erstelle...' : 'Erstellen'}
              </button>
            </div>
            {createMut.isError && (
              <p className="text-red-400 text-sm mt-2">
                {(createMut.error as any)?.response?.data?.detail || 'Fehler beim Erstellen'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
