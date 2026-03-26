import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface MonitoringScript {
  id: string
  name: string
  description: string
  interpreter: string
  expected_output: string
}

interface ScriptSelectorProps {
  tenantId: string
  osFamily: string | null
  config: Record<string, string>
  onChange: (k: string, v: string) => void
}

export default function ScriptSelector({ tenantId, osFamily, config, onChange }: ScriptSelectorProps) {
  const { data: scripts = [] } = useQuery<MonitoringScript[]>({
    queryKey: ['monitoring-scripts', tenantId],
    queryFn: () => api.get('/api/v1/scripts/', { params: { tenant_id: tenantId } }).then(r => r.data),
  })

  // Filter scripts by OS compatibility
  const filtered = scripts.filter(s => {
    if (osFamily === 'windows') return s.interpreter === 'powershell' || s.interpreter === 'python'
    if (osFamily === 'linux') return s.interpreter === 'bash' || s.interpreter === 'python'
    return true
  })

  const selectedScript = filtered.find(s => s.id === config.script_id)
  const useLocal = config._mode === 'local'

  return (
    <div className="space-y-3">
      {!useLocal ? (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Script</label>
            <select
              value={config.script_id ?? ''}
              onChange={e => {
                const script = filtered.find(s => s.id === e.target.value)
                onChange('script_id', e.target.value)
                if (script) {
                  onChange('expected_output', script.expected_output)
                  onChange('script_interpreter', script.interpreter)
                }
              }}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
            >
              <option value="">Script auswählen…</option>
              {filtered.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.interpreter}, {s.expected_output})
                </option>
              ))}
            </select>
            {selectedScript?.description && (
              <p className="text-xs text-gray-500 mt-1">{selectedScript.description}</p>
            )}
            {filtered.length === 0 && scripts.length > 0 && (
              <p className="text-xs text-amber-600 mt-1">Keine kompatiblen Scripts für diesen Host-Typ ({osFamily})</p>
            )}
          </div>
          <button type="button" onClick={() => { onChange('_mode', 'local'); onChange('script_id', '') }}
            className="text-xs text-gray-500 hover:text-gray-700 underline">
            Stattdessen lokales Script verwenden
          </button>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lokaler Script-Pfad</label>
            <input value={config.script_path ?? ''} onChange={e => onChange('script_path', e.target.value)}
              placeholder={osFamily === 'windows' ? 'C:\\Scripts\\check.ps1' : '/opt/scripts/check.sh'}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Interpreter</label>
              <select value={config.script_interpreter ?? (osFamily === 'windows' ? 'powershell' : 'bash')}
                onChange={e => onChange('script_interpreter', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                <option value="powershell">PowerShell</option>
                <option value="bash">Bash</option>
                <option value="python">Python</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Output-Format</label>
              <select value={config.expected_output ?? 'nagios'}
                onChange={e => onChange('expected_output', e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                <option value="nagios">Nagios</option>
                <option value="text">Text</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={() => { onChange('_mode', ''); onChange('script_path', '') }}
            className="text-xs text-gray-500 hover:text-gray-700 underline">
            Stattdessen Server-Script verwenden
          </button>
        </>
      )}
    </div>
  )
}
