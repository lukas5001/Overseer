import { getCheckTypeDef } from '../lib/constants'
import type { ConfigFieldDef } from '../lib/constants'
import ScriptSelector from './ScriptSelector'
import DiskConfigEditor from './DiskConfigEditor'
import type { DiskConfig } from './DiskConfigEditor'

interface RegistryConfigFieldsProps {
  checkType: string
  config: Record<string, string>
  onChange: (key: string, value: string) => void
  /** For script_selector: tenant ID and OS family */
  tenantId?: string
  osFamily?: string | null
  /** For disk_config */
  diskConfig?: DiskConfig
  onDiskConfigChange?: (config: DiskConfig) => void
}

export default function RegistryConfigFields({
  checkType, config, onChange,
  tenantId, osFamily,
  diskConfig, onDiskConfigChange,
}: RegistryConfigFieldsProps) {
  const def = getCheckTypeDef(checkType)
  if (!def || def.fields.length === 0) return null

  return (
    <div className="space-y-3">
      {def.fields.map(field => (
        <FieldRenderer
          key={field.key}
          field={field}
          config={config}
          onChange={onChange}
          tenantId={tenantId}
          osFamily={osFamily}
          diskConfig={diskConfig}
          onDiskConfigChange={onDiskConfigChange}
        />
      ))}
    </div>
  )
}

function FieldRenderer({ field, config, onChange, tenantId, osFamily, diskConfig, onDiskConfigChange }: {
  field: ConfigFieldDef
  config: Record<string, string>
  onChange: (key: string, value: string) => void
  tenantId?: string
  osFamily?: string | null
  diskConfig?: DiskConfig
  onDiskConfigChange?: (config: DiskConfig) => void
}) {
  if (field.type === 'script_selector') {
    return (
      <ScriptSelector
        tenantId={tenantId ?? ''}
        osFamily={osFamily ?? null}
        config={config}
        onChange={onChange}
      />
    )
  }

  if (field.type === 'disk_config') {
    if (!diskConfig || !onDiskConfigChange) return null
    return <DiskConfigEditor config={diskConfig} onChange={onDiskConfigChange} />
  }

  if (field.type === 'select' && field.options) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{field.label}</label>
        <select
          value={config[field.key] ?? field.default ?? ''}
          onChange={e => onChange(field.key, e.target.value)}
          className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none dark:bg-gray-700 dark:text-gray-200"
        >
          {field.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={config[field.key] === 'true'}
          onChange={e => onChange(field.key, e.target.checked ? 'true' : '')}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-overseer-600 focus:ring-overseer-500"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">{field.label}</span>
      </label>
    )
  }

  // text / number / password
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{field.label}</label>
      <input
        type={field.type}
        value={config[field.key] ?? ''}
        onChange={e => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none dark:bg-gray-700 dark:text-gray-200"
      />
    </div>
  )
}
