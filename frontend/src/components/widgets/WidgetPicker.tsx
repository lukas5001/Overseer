import { X } from 'lucide-react'
import { getAllWidgetTypes, type WidgetTypeDefinition } from './registry'

interface WidgetPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (type: WidgetTypeDefinition) => void
}

export default function WidgetPicker({ open, onClose, onSelect }: WidgetPickerProps) {
  if (!open) return null

  const types = getAllWidgetTypes()

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 h-full overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Widget hinzufügen</h3>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3 grid grid-cols-2 gap-3">
          {types.map(t => (
            <button
              key={t.type}
              onClick={() => {
                onSelect(t)
                onClose()
              }}
              className="flex flex-col items-center gap-2 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-500/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all text-center group"
            >
              <div className="text-gray-500 dark:text-gray-400 group-hover:text-blue-400 transition-colors">
                {t.icon}
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t.displayName}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
