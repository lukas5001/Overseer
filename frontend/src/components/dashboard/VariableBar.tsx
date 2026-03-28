import { useState, useEffect, useMemo } from 'react'
import { ChevronDown, X } from 'lucide-react'
import clsx from 'clsx'
import { useDashboardMetaHosts, useDashboardMetaServices } from '../../api/hooks'
import type { DashboardVariable, MetaHost, MetaService } from '../../types'

interface VariableBarProps {
  variables: DashboardVariable[]
  values: Record<string, string | string[]>
  onChange: (name: string, value: string | string[]) => void
  fixedVariables?: string[]
}

export default function VariableBar({ variables, values, onChange, fixedVariables }: VariableBarProps) {
  if (!variables.length) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/60 flex-shrink-0 flex-wrap">
      {variables.map(v => (
        <VariableDropdown
          key={v.name}
          variable={v}
          value={values[v.name] ?? v.defaultValue ?? '__all__'}
          onChange={val => onChange(v.name, val)}
          disabled={fixedVariables?.includes(v.name)}
          parentValue={v.dependsOn ? values[v.dependsOn] : undefined}
        />
      ))}
    </div>
  )
}

interface VariableDropdownProps {
  variable: DashboardVariable
  value: string | string[]
  onChange: (value: string | string[]) => void
  disabled?: boolean
  parentValue?: string | string[]
}

function VariableDropdown({ variable, value, onChange, disabled, parentValue }: VariableDropdownProps) {
  const [open, setOpen] = useState(false)

  // Resolve host_id for cascading services query
  const parentHostId = useMemo(() => {
    if (variable.query !== 'all_services' || !parentValue) return undefined
    if (Array.isArray(parentValue)) return parentValue[0]
    if (parentValue === '__all__') return undefined
    return parentValue
  }, [variable.query, parentValue])

  const { data: hosts } = useDashboardMetaHosts()
  const { data: services } = useDashboardMetaServices(parentHostId)

  const options = useMemo(() => {
    if (variable.type === 'custom') {
      return (variable.customValues || '').split(',').map(v => v.trim()).filter(Boolean).map(v => ({ id: v, label: v }))
    }
    if (variable.query === 'all_hosts' && hosts) {
      return hosts.map((h: MetaHost) => ({ id: h.id, label: h.display_name }))
    }
    if (variable.query === 'all_services' && services) {
      return services.map((s: MetaService) => ({ id: s.id, label: `${s.host} - ${s.name}` }))
    }
    return []
  }, [variable, hosts, services])

  const allOptions = useMemo(() => {
    if (variable.includeAll) {
      return [{ id: '__all__', label: 'Alle' }, ...options]
    }
    return options
  }, [variable.includeAll, options])

  // Reset to "All" when parent changes (cascading)
  useEffect(() => {
    if (variable.dependsOn && parentValue !== undefined) {
      onChange(variable.includeAll ? '__all__' : (options[0]?.id ?? '__all__'))
    }
  }, [parentValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentValues = Array.isArray(value) ? value : [value]
  const displayLabel = useMemo(() => {
    if (currentValues.includes('__all__')) return 'Alle'
    if (currentValues.length === 1) {
      return allOptions.find(o => o.id === currentValues[0])?.label || currentValues[0]
    }
    return `${currentValues.length} ausgewählt`
  }, [currentValues, allOptions])

  function toggleValue(id: string) {
    if (!variable.multiSelect) {
      onChange(id)
      setOpen(false)
      return
    }
    if (id === '__all__') {
      onChange('__all__')
      setOpen(false)
      return
    }
    const cur = currentValues.filter(v => v !== '__all__')
    const next = cur.includes(id) ? cur.filter(v => v !== id) : [...cur, id]
    onChange(next.length === 0 ? '__all__' : next)
  }

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors',
          disabled
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500'
        )}
      >
        <span className="text-gray-400 dark:text-gray-500">{variable.label}:</span>
        <span className="font-medium">{displayLabel}</span>
        {!disabled && <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-500" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl min-w-[180px] max-h-60 overflow-y-auto">
            {allOptions.map(opt => {
              const selected = currentValues.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  onClick={() => toggleValue(opt.id)}
                  className={clsx(
                    'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2',
                    selected && 'bg-blue-600/20 text-blue-400'
                  )}
                >
                  {variable.multiSelect && (
                    <span className={clsx(
                      'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                      selected ? 'border-blue-500 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                    )}>
                      {selected && <X className="w-2.5 h-2.5 text-white" />}
                    </span>
                  )}
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
            {allOptions.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 p-3 text-center">Keine Optionen</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
