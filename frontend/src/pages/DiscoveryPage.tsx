import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radar, Play, Plus, Ban, Check, ChevronDown, ChevronUp, X, Eye, EyeOff, Server, Printer, Router as RouterIcon, HelpCircle, Link2 } from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import {
  useDiscoveryResults, useDiscoveryScans, useStartNetworkScan,
  useAddDiscoveryHost, useIgnoreDiscoveryResult, useBulkAddDiscovery,
  useDiscoveryIgnored, useUnignoreDiscoveryResult, useCollectors,
} from '../api/hooks'
import type { DiscoveryResult, Collector, HostTypeConfig } from '../types'

// ── Device type icons ───────────────────────────────────────────────────────

function DeviceTypeIcon({ type }: { type: string | null }) {
  switch (type) {
    case 'server': return <Server className="w-4 h-4 text-blue-400" />
    case 'printer': return <Printer className="w-4 h-4 text-yellow-400" />
    case 'network_device': return <RouterIcon className="w-4 h-4 text-green-400" />
    default: return <HelpCircle className="w-4 h-4 text-gray-400 dark:text-gray-500" />
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    known: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    added: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    ignored: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  }
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', colors[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400')}>
      {status === 'new' ? 'New' : status === 'known' ? 'Known' : status === 'added' ? 'Added' : status}
    </span>
  )
}

function ScanStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  }
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', colors[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400')}>
      {status}
    </span>
  )
}

// ── Scan Start Panel ────────────────────────────────────────────────────────

function ScanPanel({ collectors }: { collectors: Collector[] }) {
  const [target, setTarget] = useState('')
  const [ports, setPorts] = useState('22,80,443,161,3306,5432,6379,8080,3389,9100')
  const [collectorId, setCollectorId] = useState(collectors[0]?.id ?? '')
  const [expanded, setExpanded] = useState(false)
  const startScan = useStartNetworkScan()

  const handleScan = () => {
    if (!target || !collectorId) return
    startScan.mutate({ target, ports, collector_id: collectorId })
    setExpanded(false)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radar className="w-5 h-5 text-overseer-600" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Network Discovery</h2>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700"
        >
          <Play className="w-4 h-4" />
          Start Scan
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">IP Range / CIDR *</label>
              <input
                type="text" value={target} onChange={e => setTarget(e.target.value)}
                placeholder="192.168.1.0/24"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Ports</label>
              <input
                type="text" value={ports} onChange={e => setPorts(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Collector *</label>
              <select
                value={collectorId} onChange={e => setCollectorId(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500"
              >
                {collectors.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleScan}
              disabled={!target || !collectorId || startScan.isPending}
              className="px-4 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50"
            >
              {startScan.isPending ? 'Starting...' : 'Start Network Scan'}
            </button>
          </div>
          {startScan.isError && (
            <p className="text-sm text-red-600">Error: {(startScan.error as any)?.response?.data?.detail || 'Failed'}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add Host Dialog ─────────────────────────────────────────────────────────

function AddHostDialog({
  result,
  hostTypes,
  collectors,
  onClose,
}: {
  result: DiscoveryResult
  hostTypes: HostTypeConfig[]
  collectors: Collector[]
  onClose: () => void
}) {
  const [hostname, setHostname] = useState(result.hostname || result.ip_address || '')
  const [displayName, setDisplayName] = useState('')
  const [hostTypeId, setHostTypeId] = useState(hostTypes.find(h => h.name === 'Linux Server')?.id || hostTypes[0]?.id || '')
  const [collectorId, setCollectorId] = useState(collectors[0]?.id ?? '')
  const [tags, setTags] = useState('')
  const [selectedChecks, setSelectedChecks] = useState<Set<string>>(new Set(result.suggested_checks))
  const addHost = useAddDiscoveryHost()

  const toggleCheck = (c: string) => {
    const next = new Set(selectedChecks)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    setSelectedChecks(next)
  }

  const handleAdd = () => {
    const checks = Array.from(selectedChecks).map(ct => ({
      check_type: ct,
      name: ct,
      config: ct === 'http' ? { url: `http://${result.ip_address || hostname}/` } :
              ct === 'ssl_certificate' ? { hostname: result.ip_address || hostname, port: 443 } : {},
    }))

    addHost.mutate({
      resultId: result.id,
      data: {
        hostname,
        display_name: displayName || undefined,
        ip_address: result.ip_address || undefined,
        host_type_id: hostTypeId,
        tags: tags ? tags.split(',').map(t => t.trim()) : [],
        checks,
        collector_id: collectorId || undefined,
      },
    }, { onSuccess: onClose })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Host from Discovery</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 dark:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Hostname *</label>
            <input type="text" value={hostname} onChange={e => setHostname(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Display Name</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="Optional"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          {result.ip_address && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">IP Address</label>
              <input type="text" value={result.ip_address} disabled
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Host Type *</label>
            <select value={hostTypeId} onChange={e => setHostTypeId(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
              {hostTypes.map(ht => (
                <option key={ht.id} value={ht.id}>{ht.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Collector</label>
            <select value={collectorId} onChange={e => setCollectorId(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
              <option value="">None (Agent-managed)</option>
              {collectors.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tags</label>
            <input type="text" value={tags} onChange={e => setTags(e.target.value)}
              placeholder="tag1, tag2, ..."
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {result.suggested_checks.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 dark:text-gray-500 mb-2">Suggested Checks</label>
              <div className="flex flex-wrap gap-2">
                {result.suggested_checks.map(c => (
                  <button
                    key={c}
                    onClick={() => toggleCheck(c)}
                    className={clsx(
                      'px-3 py-1 rounded-lg text-xs font-medium border transition-colors',
                      selectedChecks.has(c)
                        ? 'bg-overseer-50 border-overseer-300 text-overseer-700'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    {selectedChecks.has(c) ? <Check className="w-3 h-3 inline mr-1" /> : null}
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {addHost.isError && (
            <p className="text-sm text-red-600">{(addHost.error as any)?.response?.data?.detail || 'Error adding host'}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">Cancel</button>
          <button
            onClick={handleAdd}
            disabled={!hostname || !hostTypeId || addHost.isPending}
            className="px-4 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50"
          >
            {addHost.isPending ? 'Adding...' : 'Add Host'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function DiscoveryPage() {
  const [statusFilter, setStatusFilter] = useState<string>('new,known')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [showIgnored, setShowIgnored] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [addDialogResult, setAddDialogResult] = useState<DiscoveryResult | null>(null)
  const [showScans, setShowScans] = useState(false)

  const { data: results = [], isLoading } = useDiscoveryResults({
    status: statusFilter || undefined,
    source: sourceFilter || undefined,
    limit: 200,
  })
  const { data: scans = [] } = useDiscoveryScans()
  const { data: collectors = [] } = useCollectors()
  const { data: hostTypes = [] } = useQuery<HostTypeConfig[]>({
    queryKey: ['host-types'],
    queryFn: () => api.get('/api/v1/host-types/').then(r => r.data),
  })
  const { data: ignored = [] } = useDiscoveryIgnored()
  const ignoreMutation = useIgnoreDiscoveryResult()
  const unignoreMutation = useUnignoreDiscoveryResult()
  const bulkAdd = useBulkAddDiscovery()

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const selectAllNew = () => {
    const newIds = results.filter(r => r.status === 'new').map(r => r.id)
    setSelectedIds(new Set(newIds))
  }

  const handleBulkAdd = () => {
    if (selectedIds.size === 0 || hostTypes.length === 0) return
    const serverType = hostTypes.find(h => h.name === 'Linux Server') || hostTypes[0]
    bulkAdd.mutate({
      ids: Array.from(selectedIds),
      host_type_id: serverType.id,
      collector_id: collectors[0]?.id,
    }, {
      onSuccess: () => setSelectedIds(new Set()),
    })
  }

  const lastScan = scans[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Discovery</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-0.5">
            Auto-discovered devices and services
            {lastScan && (
              <> &middot; Last scan: {formatDistanceToNow(new Date(lastScan.created_at), { addSuffix: true, locale: de })}
              {lastScan.status === 'completed' && `, ${lastScan.hosts_found} hosts found`}</>
            )}
          </p>
        </div>
      </div>

      {/* Scan Panel */}
      {collectors.length > 0 && <ScanPanel collectors={collectors} />}

      {/* Scans History Toggle */}
      {scans.length > 0 && (
        <div>
          <button
            onClick={() => setShowScans(!showScans)}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
          >
            {showScans ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Recent Scans ({scans.length})
          </button>
          {showScans && (
            <div className="mt-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2 text-left">Target</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Hosts</th>
                    <th className="px-4 py-2 text-left">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {scans.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-2 font-mono text-xs">{s.target}</td>
                      <td className="px-4 py-2"><ScanStatusBadge status={s.status} /></td>
                      <td className="px-4 py-2">{s.hosts_found}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                        {s.started_at && formatDistanceToNow(new Date(s.started_at), { addSuffix: true, locale: de })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filters + Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
          {[
            { label: 'New / Known', value: 'new,known' },
            { label: 'All', value: '' },
            { label: 'Added', value: 'added' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                statusFilter === f.value
                  ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-2 py-1.5"
        >
          <option value="">All Sources</option>
          <option value="network_scan">Network Scan</option>
          <option value="agent_discovery">Agent Discovery</option>
        </select>

        <div className="flex-1" />

        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkAdd}
            disabled={bulkAdd.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Selected ({selectedIds.size})
          </button>
        )}

        <button
          onClick={() => setShowIgnored(!showIgnored)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            showIgnored ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
          )}
        >
          {showIgnored ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          Ignored ({(ignored as any[]).length})
        </button>
      </div>

      {/* Results Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
        ) : results.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">
            <Radar className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-sm">No discovery results yet.</p>
            <p className="text-xs mt-1">Start a network scan or wait for agent discovery data.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && results.filter(r => r.status === 'new').every(r => selectedIds.has(r.id))}
                    onChange={e => e.target.checked ? selectAllNew() : setSelectedIds(new Set())}
                    className="rounded"
                  />
                </th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">IP / Hostname</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">OS</th>
                <th className="px-3 py-2 text-left">Ports</th>
                <th className="px-3 py-2 text-left">Suggested Checks</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Last Seen</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {results.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-3 py-2">
                    {r.status === 'new' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        className="rounded"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{r.ip_address || '—'}</div>
                    {r.hostname && <div className="text-xs text-gray-500 dark:text-gray-400">{r.hostname}</div>}
                    {r.matched_host_id && (
                      <a href={`/hosts/${r.matched_host_id}`} className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
                        <Link2 className="w-3 h-3" />{r.matched_hostname || 'Monitored'}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <DeviceTypeIcon type={r.device_type} />
                      <span className="text-xs text-gray-600 dark:text-gray-400">{r.device_type || 'unknown'}</span>
                    </div>
                    {r.vendor && <div className="text-xs text-gray-400 dark:text-gray-500">{r.vendor}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{r.os_guess || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.open_ports.slice(0, 6).map((p, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono">
                          {p.port}{p.service ? `/${p.service}` : ''}
                        </span>
                      ))}
                      {r.open_ports.length > 6 && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">+{r.open_ports.length - 6}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.suggested_checks.map(c => (
                        <span key={c} className="px-1.5 py-0.5 bg-overseer-50 text-overseer-700 rounded text-xs">
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                    {r.source === 'agent_discovery' ? 'Agent' : 'Network'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                    {formatDistanceToNow(new Date(r.last_seen_at), { addSuffix: true, locale: de })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'new' && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setAddDialogResult(r)}
                          className="px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-md hover:bg-emerald-100"
                        >
                          <Plus className="w-3 h-3 inline mr-0.5" />Add
                        </button>
                        <button
                          onClick={() => ignoreMutation.mutate(r.id)}
                          className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Ban className="w-3 h-3 inline mr-0.5" />Ignore
                        </button>
                      </div>
                    )}
                    {r.status === 'known' && r.matched_host_id && (
                      <a href={`/hosts/${r.matched_host_id}`} className="text-xs text-blue-600 hover:underline">
                        View Host
                      </a>
                    )}
                    {r.status === 'added' && (
                      <span className="text-xs text-emerald-600">Added</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Ignored List */}
      {showIgnored && (ignored as any[]).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-600">Ignored Devices</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left">IP / Hostname</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {(ignored as any[]).map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-2">
                    <span className="text-gray-900 dark:text-gray-100">{r.ip_address || r.hostname || '—'}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{r.device_type || 'unknown'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{r.source}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => unignoreMutation.mutate(r.id)}
                      className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
                    >
                      Un-ignore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Agent Discovery Services */}
      {results.some(r => r.source === 'agent_discovery' && r.services.length > 0) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 dark:text-gray-600">Agent-Discovered Services</h3>
          </div>
          <div className="p-4">
            {results.filter(r => r.source === 'agent_discovery' && r.services.length > 0).map(r => (
              <div key={r.id} className="mb-4 last:mb-0">
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">{r.hostname}</h4>
                <div className="flex flex-wrap gap-2">
                  {r.services.map((svc, i) => (
                    <div key={i} className="px-2 py-1 bg-gray-50 rounded-lg text-xs border border-gray-100 dark:border-gray-800">
                      <span className="font-medium">{svc.name}</span>
                      <span className={clsx('ml-1.5', svc.status === 'running' ? 'text-green-600' : 'text-gray-400 dark:text-gray-500')}>
                        {svc.status}
                      </span>
                      {svc.ports && svc.ports.length > 0 && (
                        <span className="ml-1 text-gray-400 dark:text-gray-500">:{svc.ports.join(',')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Dialog */}
      {addDialogResult && (
        <AddHostDialog
          result={addDialogResult}
          hostTypes={hostTypes}
          collectors={collectors}
          onClose={() => setAddDialogResult(null)}
        />
      )}
    </div>
  )
}
