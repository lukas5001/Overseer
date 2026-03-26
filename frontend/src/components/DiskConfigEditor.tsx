import { Plus, X } from 'lucide-react'

export interface DiskOverride {
  path: string
  warn: string
  crit: string
}

export interface DiskConfig {
  warn: string
  crit: string
  overrides: DiskOverride[]
  exclude: string
}

interface DiskConfigEditorProps {
  config: DiskConfig
  onChange: (config: DiskConfig) => void
}

export default function DiskConfigEditor({ config, onChange }: DiskConfigEditorProps) {
  const updateOverride = (i: number, key: keyof DiskOverride, value: string) => {
    const next = [...config.overrides]
    next[i] = { ...next[i], [key]: value }
    onChange({ ...config, overrides: next })
  }

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
        Alle Partitionen werden automatisch erkannt und überwacht.
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Standard-Schwellwerte (alle Platten)</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input value={config.warn} onChange={e => onChange({ ...config, warn: e.target.value })}
              placeholder="80" type="number" min="0" max="100"
              className="w-full text-sm border border-amber-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/50" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-amber-400 pointer-events-none">% Warn</span>
          </div>
          <div className="relative flex-1">
            <input value={config.crit} onChange={e => onChange({ ...config, crit: e.target.value })}
              placeholder="90" type="number" min="0" max="100"
              className="w-full text-sm border border-red-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-400 outline-none bg-red-50/50" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-400 pointer-events-none">% Crit</span>
          </div>
        </div>
      </div>

      {config.overrides.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ausnahmen</label>
          <div className="space-y-2">
            {config.overrides.map((o, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={o.path} onChange={e => updateOverride(i, 'path', e.target.value)}
                  placeholder="/ oder C:"
                  className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                <div className="relative">
                  <input value={o.warn} onChange={e => updateOverride(i, 'warn', e.target.value)}
                    placeholder="80" type="number" min="0" max="100"
                    className="w-20 text-sm border border-amber-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 outline-none bg-amber-50/50" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-amber-400 pointer-events-none">%</span>
                </div>
                <div className="relative">
                  <input value={o.crit} onChange={e => updateOverride(i, 'crit', e.target.value)}
                    placeholder="90" type="number" min="0" max="100"
                    className="w-20 text-sm border border-red-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-400 outline-none bg-red-50/50" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-400 pointer-events-none">%</span>
                </div>
                <button onClick={() => onChange({ ...config, overrides: config.overrides.filter((_, j) => j !== i) })}
                  className="text-gray-400 hover:text-red-500 p-1" title="Entfernen">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => onChange({ ...config, overrides: [...config.overrides, { path: '', warn: '', crit: '' }] })}
        className="text-xs text-overseer-600 hover:text-overseer-700 font-medium flex items-center gap-1">
        <Plus className="w-3.5 h-3.5" /> Ausnahme hinzufügen
      </button>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Ausschließen (kommagetrennt, optional)</label>
        <input value={config.exclude} onChange={e => onChange({ ...config, exclude: e.target.value })}
          placeholder="/boot/efi, /snap/..."
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
      </div>
    </div>
  )
}
