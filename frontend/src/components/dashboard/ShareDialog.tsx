import { useState } from 'react'
import { X, Copy, Check, Link2, Globe, Code, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useShareDashboard, useRevokeDashboardShare } from '../../api/hooks'
import type { DashboardFull, DashboardVariable } from '../../types'

interface ShareDialogProps {
  dashboard: DashboardFull
  open: boolean
  onClose: () => void
  variables?: DashboardVariable[]
  variableValues?: Record<string, string | string[]>
}

type Tab = 'internal' | 'public' | 'embed'

export default function ShareDialog({ dashboard, open, onClose, variables = [], variableValues = {} }: ShareDialogProps) {
  const [tab, setTab] = useState<Tab>('internal')
  const [copied, setCopied] = useState(false)
  const [expiryDays, setExpiryDays] = useState(30)
  const [fixedVars, setFixedVars] = useState<Set<string>>(new Set())

  const shareMut = useShareDashboard()
  const revokeMut = useRevokeDashboardShare()

  if (!open) return null

  const currentUrl = window.location.href
  const baseUrl = window.location.origin
  const publicUrl = dashboard.share_token
    ? `${baseUrl}/public/d/${dashboard.share_token}`
    : null
  const embedUrl = publicUrl ? `${publicUrl}?embed=true` : null

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function createPublicLink() {
    const fixedValues: Record<string, string | string[]> = {}
    for (const name of fixedVars) {
      if (variableValues[name] !== undefined) {
        fixedValues[name] = variableValues[name]
      }
    }
    await shareMut.mutateAsync({
      id: dashboard.id,
      expires_in_days: expiryDays,
      fixed_variables: Array.from(fixedVars),
      fixed_variable_values: fixedValues,
    })
  }

  async function revokeLink() {
    await revokeMut.mutateAsync(dashboard.id)
  }

  function toggleFixedVar(name: string) {
    setFixedVars(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const TABS: { id: Tab; label: string; icon: typeof Link2 }[] = [
    { id: 'internal', label: 'Interner Link', icon: Link2 },
    { id: 'public', label: 'Public Link', icon: Globe },
    { id: 'embed', label: 'Einbetten', icon: Code },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">Dashboard teilen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 pt-3 gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setCopied(false) }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
                tab === t.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white bg-gray-700'
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === 'internal' && (
            <>
              <p className="text-xs text-gray-400">
                Dieser Link funktioniert nur für eingeloggte Benutzer desselben Tenants.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={currentUrl}
                  readOnly
                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono"
                />
                <button
                  onClick={() => copyToClipboard(currentUrl)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Kopiert!' : 'Kopieren'}
                </button>
              </div>
            </>
          )}

          {tab === 'public' && (
            <>
              {dashboard.is_shared && publicUrl ? (
                <>
                  <p className="text-xs text-gray-400">
                    Public Link ist aktiv. Jeder mit diesem Link kann das Dashboard sehen.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={publicUrl}
                      readOnly
                      className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono"
                    />
                    <button
                      onClick={() => copyToClipboard(publicUrl)}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Kopiert!' : 'Kopieren'}
                    </button>
                  </div>
                  {dashboard.share_expires_at && (
                    <p className="text-xs text-gray-500">
                      Läuft ab: {new Date(dashboard.share_expires_at).toLocaleDateString('de-DE')}
                    </p>
                  )}
                  {dashboard.share_config?.fixed_variables?.length ? (
                    <p className="text-xs text-gray-500">
                      Fixierte Variablen: {dashboard.share_config.fixed_variables.join(', ')}
                    </p>
                  ) : null}
                  <button
                    onClick={revokeLink}
                    disabled={revokeMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 border border-red-800 rounded-lg hover:bg-red-900/30 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {revokeMut.isPending ? 'Widerrufe...' : 'Link widerrufen'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400">
                    Erstelle einen Public Link. Jeder mit diesem Link kann das Dashboard sehen (ohne Login).
                  </p>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Ablaufdatum</label>
                    <select
                      value={expiryDays}
                      onChange={e => setExpiryDays(Number(e.target.value))}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200"
                    >
                      <option value={1}>1 Tag</option>
                      <option value={7}>7 Tage</option>
                      <option value={30}>30 Tage</option>
                      <option value={365}>Kein Ablauf (365 Tage)</option>
                    </select>
                  </div>

                  {variables.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Variablen fixieren</label>
                      <div className="space-y-1">
                        {variables.map(v => (
                          <label key={v.name} className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                              type="checkbox"
                              checked={fixedVars.has(v.name)}
                              onChange={() => toggleFixedVar(v.name)}
                              className="rounded border-gray-600"
                            />
                            ${v.name} ({v.label})
                            {fixedVars.has(v.name) && (
                              <span className="text-gray-500 ml-1">
                                = {JSON.stringify(variableValues[v.name] ?? v.defaultValue)}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={createPublicLink}
                    disabled={shareMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                  >
                    <Globe className="w-4 h-4" />
                    {shareMut.isPending ? 'Erstelle...' : 'Public Link erstellen'}
                  </button>
                </>
              )}
            </>
          )}

          {tab === 'embed' && (
            <>
              {embedUrl ? (
                <>
                  <p className="text-xs text-gray-400">
                    Kopiere den iFrame-Code um das Dashboard in eine Website einzubetten.
                  </p>
                  <div className="bg-gray-900 border border-gray-600 rounded-lg p-3">
                    <code className="text-xs text-gray-300 break-all">
                      {`<iframe src="${embedUrl}" width="100%" height="600" frameborder="0"></iframe>`}
                    </code>
                  </div>
                  <button
                    onClick={() => copyToClipboard(`<iframe src="${embedUrl}" width="100%" height="600" frameborder="0"></iframe>`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Kopiert!' : 'Code kopieren'}
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-400">
                  Erstelle zuerst einen Public Link im Tab "Public Link", um das Einbetten zu ermöglichen.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
