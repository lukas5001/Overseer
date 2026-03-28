import { Plus, Trash2, GripVertical } from 'lucide-react'
import type { DashboardVariable } from '../../types'

interface VariableSettingsProps {
  variables: DashboardVariable[]
  onChange: (variables: DashboardVariable[]) => void
}

const QUERY_OPTIONS = [
  { label: 'Alle Hosts', value: 'all_hosts' },
  { label: 'Alle Services', value: 'all_services' },
  { label: 'Hosts mit Tag', value: 'hosts_with_tag' },
]

function emptyVariable(): DashboardVariable {
  return {
    name: '',
    label: '',
    type: 'query',
    query: 'all_hosts',
    multiSelect: false,
    includeAll: true,
    defaultValue: '__all__',
  }
}

export default function VariableSettings({ variables, onChange }: VariableSettingsProps) {
  function addVariable() {
    onChange([...variables, emptyVariable()])
  }

  function updateVariable(idx: number, partial: Partial<DashboardVariable>) {
    const updated = variables.map((v, i) => i === idx ? { ...v, ...partial } : v)
    // Validate: no circular dependencies
    onChange(updated)
  }

  function removeVariable(idx: number) {
    const removed = variables[idx]
    // Also clear dependsOn references to the removed variable
    const updated = variables
      .filter((_, i) => i !== idx)
      .map(v => v.dependsOn === removed.name ? { ...v, dependsOn: undefined } : v)
    onChange(updated)
  }

  // Available parent variables for cascading (only variables defined before the current one)
  function getParentOptions(idx: number): string[] {
    return variables.slice(0, idx).map(v => v.name).filter(Boolean)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-500 dark:text-gray-400 font-medium">Variablen</label>
        <button
          onClick={addVariable}
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Variable hinzufügen
        </button>
      </div>

      {variables.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
          Keine Variablen definiert. Variablen erscheinen als Dropdowns unter dem Dashboard-Titel.
        </p>
      )}

      {variables.map((v, idx) => (
        <div key={idx} className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <GripVertical className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">#{idx + 1}</span>
            <div className="flex-1" />
            <button onClick={() => removeVariable(idx)} className="text-gray-400 dark:text-gray-500 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Name (für Referenz: $name)</label>
              <input
                value={v.name}
                onChange={e => updateVariable(idx, { name: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() })}
                placeholder="z.B. host"
                className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Label (Anzeige)</label>
              <input
                value={v.label}
                onChange={e => updateVariable(idx, { label: e.target.value })}
                placeholder="z.B. Host"
                className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Typ</label>
            <select
              value={v.type}
              onChange={e => updateVariable(idx, { type: e.target.value as 'query' | 'custom' })}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
            >
              <option value="query">Query (aus Datenbank)</option>
              <option value="custom">Benutzerdefiniert</option>
            </select>
          </div>

          {v.type === 'query' ? (
            <>
              <div>
                <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Query</label>
                <select
                  value={v.query || 'all_hosts'}
                  onChange={e => updateVariable(idx, { query: e.target.value as DashboardVariable['query'] })}
                  className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
                >
                  {QUERY_OPTIONS.map(q => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              </div>
              {v.query === 'hosts_with_tag' && (
                <div>
                  <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Tag</label>
                  <input
                    value={v.queryParam || ''}
                    onChange={e => updateVariable(idx, { queryParam: e.target.value })}
                    placeholder="Tag-Name"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
                  />
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Werte (komma-separiert)</label>
              <input
                value={v.customValues || ''}
                onChange={e => updateVariable(idx, { customValues: e.target.value })}
                placeholder="production, staging, development"
                className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
              />
            </div>
          )}

          {/* Cascading dependency */}
          {getParentOptions(idx).length > 0 && (
            <div>
              <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Abhängig von (Cascading)</label>
              <select
                value={v.dependsOn || ''}
                onChange={e => updateVariable(idx, { dependsOn: e.target.value || undefined })}
                className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
              >
                <option value="">Keine Abhängigkeit</option>
                {getParentOptions(idx).map(name => (
                  <option key={name} value={name}>${name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={v.multiSelect}
                onChange={e => updateVariable(idx, { multiSelect: e.target.checked })}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Multi-Select
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={v.includeAll}
                onChange={e => updateVariable(idx, { includeAll: e.target.checked })}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              "Alle" Option
            </label>
          </div>
        </div>
      ))}
    </div>
  )
}
