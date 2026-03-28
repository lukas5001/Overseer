import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, Plus, Download, Send, RotateCcw, Trash2, Pencil,
  ChevronDown, X, Play,
} from 'lucide-react'
import clsx from 'clsx'
import { format, subDays } from 'date-fns'
import { api } from '../api/client'
import {
  getRole, getTenantId,
  useReportSchedules, useCreateReportSchedule, useUpdateReportSchedule,
  useDeleteReportSchedule, useReportHistory, useGenerateReport,
  useResendReport, useRetryReport,
} from '../api/hooks'
import type {
  Tenant, ReportSchedule, ReportDelivery,
  ReportRecipients, ReportBranding, ReportGenerateRequest,
} from '../types'

type Tab = 'schedules' | 'history'

const REPORT_TYPES = [
  { value: 'executive', label: 'Executive Summary' },
  { value: 'technical', label: 'Technischer Report' },
]

const FREQUENCY_PRESETS = [
  { label: 'Wöchentlich (Mo 8:00)', cron: '0 8 * * 1' },
  { label: 'Monatlich (1., 8:00)', cron: '0 8 1 * *' },
  { label: 'Quartalsweise (1. Jan/Apr/Jul/Okt)', cron: '0 8 1 1,4,7,10 *' },
]

function cronToLabel(cron: string): string {
  const preset = FREQUENCY_PRESETS.find(p => p.cron === cron)
  if (preset) return preset.label
  return cron
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Pending' },
    generating: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Generating...' },
    sending: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Sending...' },
    sent: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Sent' },
    failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
  }
  const s = map[status] || map.pending
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', s.bg, s.text)}>
      {s.label}
    </span>
  )
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function localDate(s: string | null): string {
  if (!s) return '—'
  try { return format(new Date(s), 'dd.MM.yyyy HH:mm') } catch { return s }
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ReportsPage() {
  const role = getRole()
  const isSuperAdmin = role === 'super_admin'
  const isAdmin = role === 'super_admin' || role === 'tenant_admin'

  const [tab, setTab] = useState<Tab>('schedules')
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [editSchedule, setEditSchedule] = useState<ReportSchedule | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
    enabled: isSuperAdmin,
  })

  const activeTenantId = selectedTenantId || tenants[0]?.id || getTenantId() || ''

  const { data: schedules = [], isLoading: loadingSchedules } = useReportSchedules(activeTenantId || undefined)
  const { data: history = [], isLoading: loadingHistory } = useReportHistory(
    activeTenantId ? { tenant_id: activeTenantId, limit: 100 } : { limit: 100 }
  )

  const deleteSchedule = useDeleteReportSchedule()
  const updateSchedule = useUpdateReportSchedule()
  const resendReport = useResendReport()
  const retryReport = useRetryReport()

  function handleToggleEnabled(s: ReportSchedule) {
    updateSchedule.mutate({ id: s.id, enabled: !s.enabled })
  }

  function handleDeleteSchedule(s: ReportSchedule) {
    if (!confirm(`Schedule "${s.name}" wirklich löschen?`)) return
    deleteSchedule.mutate(s.id)
  }

  async function handleDownload(d: ReportDelivery) {
    try {
      const resp = await api.get(`/api/v1/reports/download/${d.id}`, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `report_${d.report_type}_${d.report_period_start}_${d.report_period_end}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch { alert('Download fehlgeschlagen') }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">PDF Reports</h1>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowGenerateDialog(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
              <Play className="w-4 h-4" /> Jetzt generieren
            </button>
            <button onClick={() => { setEditSchedule(null); setShowCreateDialog(true) }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700">
              <Plus className="w-4 h-4" /> Neuer Schedule
            </button>
          </div>
        )}
      </div>

      {/* Tenant selector */}
      {isSuperAdmin && tenants.length > 0 && (
        <div className="mb-4 relative inline-block">
          <select value={activeTenantId} onChange={e => setSelectedTenantId(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg pl-3 pr-8 py-2 bg-white appearance-none outline-none focus:ring-2 focus:ring-overseer-500">
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['schedules', 'history'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t ? 'border-overseer-600 text-overseer-700' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {t === 'schedules' ? 'Schedules' : 'History'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'schedules' && (
        <SchedulesTab
          schedules={schedules}
          loading={loadingSchedules}
          onEdit={s => { setEditSchedule(s); setShowCreateDialog(true) }}
          onDelete={handleDeleteSchedule}
          onToggle={handleToggleEnabled}
        />
      )}
      {tab === 'history' && (
        <HistoryTab
          history={history}
          loading={loadingHistory}
          onDownload={handleDownload}
          onResend={d => resendReport.mutate(d.id)}
          onRetry={d => retryReport.mutate(d.id)}
        />
      )}

      {/* Create/Edit Dialog */}
      {showCreateDialog && (
        <ScheduleDialog
          tenantId={activeTenantId}
          schedule={editSchedule}
          onClose={() => { setShowCreateDialog(false); setEditSchedule(null) }}
        />
      )}

      {/* Generate Now Dialog */}
      {showGenerateDialog && (
        <GenerateDialog
          tenantId={activeTenantId}
          onClose={() => setShowGenerateDialog(false)}
        />
      )}

      {/* Preview overlay */}
      {previewHtml && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] overflow-auto relative">
            <button onClick={() => setPreviewHtml(null)}
              className="absolute top-3 right-3 p-1 rounded-lg hover:bg-gray-100 z-10">
              <X className="w-5 h-5" />
            </button>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Schedules Tab ────────────────────────────────────────────────────────────

function SchedulesTab({ schedules, loading, onEdit, onDelete, onToggle }: {
  schedules: ReportSchedule[]
  loading: boolean
  onEdit: (s: ReportSchedule) => void
  onDelete: (s: ReportSchedule) => void
  onToggle: (s: ReportSchedule) => void
}) {
  if (loading) return <div className="text-gray-400 text-sm">Lade Schedules...</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">Name</th>
            <th className="px-6 py-3 text-left">Typ</th>
            <th className="px-6 py-3 text-left">Frequenz</th>
            <th className="px-6 py-3 text-left">Empfänger</th>
            <th className="px-6 py-3 text-left">Nächster Lauf</th>
            <th className="px-6 py-3 text-left">Letzter Lauf</th>
            <th className="px-6 py-3 text-center">Status</th>
            <th className="px-6 py-3 text-right">Aktionen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {schedules.map(s => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
              <td className="px-6 py-3 text-gray-600 capitalize">{s.report_type}</td>
              <td className="px-6 py-3 text-gray-600">{cronToLabel(s.cron_expression)}</td>
              <td className="px-6 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                {(s.recipients?.to || []).join(', ') || '—'}
              </td>
              <td className="px-6 py-3 text-gray-500">{localDate(s.next_run_at)}</td>
              <td className="px-6 py-3 text-gray-500">{localDate(s.last_run_at)}</td>
              <td className="px-6 py-3 text-center">
                <button onClick={() => onToggle(s)}
                  className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                    s.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                  {s.enabled ? 'Active' : 'Disabled'}
                </button>
              </td>
              <td className="px-6 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => onEdit(s)} title="Bearbeiten"
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => onDelete(s)} title="Löschen"
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {schedules.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm">
          Keine Report-Schedules vorhanden. Erstelle einen mit "Neuer Schedule".
        </div>
      )}
    </div>
  )
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ history, loading, onDownload, onResend, onRetry }: {
  history: ReportDelivery[]
  loading: boolean
  onDownload: (d: ReportDelivery) => void
  onResend: (d: ReportDelivery) => void
  onRetry: (d: ReportDelivery) => void
}) {
  if (loading) return <div className="text-gray-400 text-sm">Lade History...</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">Datum</th>
            <th className="px-6 py-3 text-left">Schedule</th>
            <th className="px-6 py-3 text-left">Typ</th>
            <th className="px-6 py-3 text-left">Zeitraum</th>
            <th className="px-6 py-3 text-left">Empfänger</th>
            <th className="px-6 py-3 text-center">Status</th>
            <th className="px-6 py-3 text-right">Größe</th>
            <th className="px-6 py-3 text-right">Aktionen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {history.map(d => (
            <tr key={d.id} className="hover:bg-gray-50">
              <td className="px-6 py-3 text-gray-500">{localDate(d.created_at)}</td>
              <td className="px-6 py-3 text-gray-900 font-medium">{d.schedule_name || 'Ad-hoc'}</td>
              <td className="px-6 py-3 text-gray-600 capitalize">{d.report_type}</td>
              <td className="px-6 py-3 text-gray-500">{d.report_period_start} – {d.report_period_end}</td>
              <td className="px-6 py-3 text-gray-500 text-xs max-w-[160px] truncate">
                {(d.recipients?.to || []).join(', ') || '—'}
              </td>
              <td className="px-6 py-3 text-center">
                {statusBadge(d.status)}
                {d.error_message && (
                  <span className="block text-xs text-red-500 mt-0.5 max-w-[200px] truncate" title={d.error_message}>
                    {d.error_message}
                  </span>
                )}
              </td>
              <td className="px-6 py-3 text-right text-gray-500">{formatBytes(d.pdf_size_bytes)}</td>
              <td className="px-6 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {d.pdf_path && d.status === 'sent' && (
                    <button onClick={() => onDownload(d)} title="Download"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  {d.pdf_path && d.status === 'sent' && (
                    <button onClick={() => onResend(d)} title="Erneut senden"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                  {d.status === 'failed' && (
                    <button onClick={() => onRetry(d)} title="Retry"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-orange-600">
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {history.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm">Noch keine Reports generiert.</div>
      )}
    </div>
  )
}

// ── Schedule Create/Edit Dialog ──────────────────────────────────────────────

function ScheduleDialog({ tenantId, schedule, onClose }: {
  tenantId: string
  schedule: ReportSchedule | null
  onClose: () => void
}) {
  const isEdit = !!schedule
  const create = useCreateReportSchedule()
  const update = useUpdateReportSchedule()

  const [name, setName] = useState(schedule?.name ?? '')
  const [reportType, setReportType] = useState(schedule?.report_type ?? 'executive')
  const [cronExpr, setCronExpr] = useState(schedule?.cron_expression ?? '0 8 1 * *')
  const [customCron, setCustomCron] = useState('')
  const [toEmails, setToEmails] = useState((schedule?.recipients?.to ?? []).join(', '))
  const [ccEmails, setCcEmails] = useState((schedule?.recipients?.cc ?? []).join(', '))
  const [companyName, setCompanyName] = useState(schedule?.branding?.company_name ?? 'Overseer')
  const [primaryColor, setPrimaryColor] = useState(schedule?.branding?.primary_color ?? '#3b82f6')
  const [footerText, setFooterText] = useState(schedule?.branding?.footer_text ?? 'Generated by Overseer')
  const [coverText, setCoverText] = useState(schedule?.cover_text ?? '')
  const [tz, setTz] = useState(schedule?.timezone ?? 'Europe/Rome')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)
  const [saving, setSaving] = useState(false)

  const effectiveCron = customCron || cronExpr

  function parseEmails(s: string): string[] {
    return s.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const recipients: ReportRecipients = {
      to: parseEmails(toEmails),
      cc: parseEmails(ccEmails),
      bcc: [],
    }
    const branding: ReportBranding = {
      company_name: companyName,
      primary_color: primaryColor,
      footer_text: footerText,
    }

    try {
      if (isEdit) {
        await update.mutateAsync({
          id: schedule!.id,
          name,
          report_type: reportType,
          cron_expression: effectiveCron,
          recipients,
          branding,
          cover_text: coverText || undefined,
          timezone: tz,
          enabled,
        })
      } else {
        await create.mutateAsync({
          tenant_id: tenantId,
          name,
          report_type: reportType,
          cron_expression: effectiveCron,
          recipients,
          branding,
          cover_text: coverText || undefined,
          timezone: tz,
          enabled,
        })
      }
      onClose()
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? 'Schedule bearbeiten' : 'Neuer Report-Schedule'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required
              placeholder="z.B. Monthly Executive Report"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* Report Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Report-Typ</label>
            <select value={reportType} onChange={e => setReportType(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-overseer-500">
              {REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Frequency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Frequenz</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {FREQUENCY_PRESETS.map(p => (
                <button key={p.cron} type="button"
                  onClick={() => { setCronExpr(p.cron); setCustomCron('') }}
                  className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    cronExpr === p.cron && !customCron
                      ? 'bg-overseer-600 text-white border-overseer-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50')}>
                  {p.label}
                </button>
              ))}
            </div>
            <input type="text" value={customCron} onChange={e => setCustomCron(e.target.value)}
              placeholder="Oder eigene Cron-Expression (z.B. 0 8 * * 1)"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 font-mono" />
          </div>

          {/* Recipients */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Empfänger (To)</label>
            <input type="text" value={toEmails} onChange={e => setToEmails(e.target.value)} required
              placeholder="email@example.com, other@example.com"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CC (optional)</label>
            <input type="text" value={ccEmails} onChange={e => setCcEmails(e.target.value)}
              placeholder="cc@example.com"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* Branding */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Branding</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Firmenname</label>
                <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Primärfarbe</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                    className="w-8 h-8 rounded border border-gray-300 cursor-pointer" />
                  <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 font-mono" />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">Footer-Text</label>
              <input type="text" value={footerText} onChange={e => setFooterText(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
          </div>

          {/* Cover Text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Anschreiben (optional)</label>
            <textarea value={coverText} onChange={e => setCoverText(e.target.value)} rows={3}
              placeholder="Text oberhalb des Reports..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* Timezone + Enabled */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Zeitzone</label>
              <input type="text" value={tz} onChange={e => setTz(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-overseer-600 focus:ring-overseer-500" />
              <span className="text-sm text-gray-700">Aktiviert</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              Abbrechen
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-overseer-600 text-white rounded-lg hover:bg-overseer-700 disabled:opacity-50">
              {saving ? 'Speichere...' : isEdit ? 'Speichern' : 'Erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Generate Now Dialog ──────────────────────────────────────────────────────

function GenerateDialog({ tenantId, onClose }: {
  tenantId: string
  onClose: () => void
}) {
  const generate = useGenerateReport()

  const [reportType, setReportType] = useState('executive')
  const [periodStart, setPeriodStart] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [periodEnd, setPeriodEnd] = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'))
  const [toEmails, setToEmails] = useState('')
  const [companyName, setCompanyName] = useState('Overseer')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<ReportDelivery | null>(null)

  function parseEmails(s: string): string[] {
    return s.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean)
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setGenerating(true)
    try {
      const emails = parseEmails(toEmails)
      const body: ReportGenerateRequest = {
        tenant_id: tenantId,
        report_type: reportType,
        period_start: periodStart,
        period_end: periodEnd,
        recipients: emails.length > 0 ? { to: emails, cc: [], bcc: [] } : undefined,
        branding: { company_name: companyName, primary_color: '#3b82f6', footer_text: `Generated by ${companyName}` },
      }
      const d = await generate.mutateAsync(body)
      setResult(d)
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Fehler bei der Generierung')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Report jetzt generieren</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="p-6 text-center space-y-4">
            <div className="text-4xl">
              {result.status === 'sent' ? '✓' : result.status === 'failed' ? '✗' : '⏳'}
            </div>
            <div className="text-sm text-gray-700">
              Status: {statusBadge(result.status)}
            </div>
            {result.error_message && (
              <p className="text-sm text-red-600">{result.error_message}</p>
            )}
            {result.pdf_path && result.status === 'sent' && (
              <button onClick={async () => {
                try {
                  const resp = await api.get(`/api/v1/reports/download/${result.id}`, { responseType: 'blob' })
                  const url = URL.createObjectURL(resp.data)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `report_${result.report_type}_${result.report_period_start}_${result.report_period_end}.pdf`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch { alert('Download fehlgeschlagen') }
              }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm rounded-lg hover:bg-overseer-700">
                <Download className="w-4 h-4" /> PDF herunterladen
              </button>
            )}
            <div>
              <button onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                Schließen
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Report-Typ</label>
              <select value={reportType} onChange={e => setReportType(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-overseer-500">
                {REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Von</label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bis</label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Empfänger (optional)</label>
              <input type="text" value={toEmails} onChange={e => setToEmails(e.target.value)}
                placeholder="Leer lassen = nur generieren, nicht senden"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Firmenname</label>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                Abbrechen
              </button>
              <button type="submit" disabled={generating}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-overseer-600 text-white rounded-lg hover:bg-overseer-700 disabled:opacity-50">
                {generating ? (
                  <>Generiere...</>
                ) : (
                  <><Play className="w-4 h-4" /> Generieren & Senden</>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
