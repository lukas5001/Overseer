import { useState } from 'react'
import { X, ThumbsUp, ThumbsDown, Loader2, Sparkles } from 'lucide-react'
import { useAiAnalyze, useAiAddKnowledge, getTenantId } from '../api/hooks'

interface Props {
  serviceId: string
  serviceName: string
  onClose: () => void
}

export default function AiAnalysisPanel({ serviceId, serviceName, onClose }: Props) {
  const analyze = useAiAnalyze()
  const addKnowledge = useAiAddKnowledge()
  const [feedbackSent, setFeedbackSent] = useState(false)

  // Auto-trigger analysis on mount
  useState(() => {
    analyze.mutate(serviceId)
  })

  const handleFeedback = (positive: boolean) => {
    if (!positive || !analyze.data?.diagnosis) return
    const tenantId = getTenantId()
    if (!tenantId) return
    addKnowledge.mutate({
      content: `Service: ${serviceName}\n${analyze.data.diagnosis}`,
      tenant_id: tenantId,
      service_id: serviceId,
    })
    setFeedbackSent(true)
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">KI-Analyse</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Service: <span className="font-medium text-gray-800 dark:text-gray-200">{serviceName}</span>
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {analyze.isPending && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            <p className="text-sm">Analyse läuft... Dies kann bis zu 2 Minuten dauern.</p>
          </div>
        )}

        {analyze.isError && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700">
              Fehler bei der Analyse: {(analyze.error as Error)?.message ?? 'Unbekannter Fehler'}
            </p>
            <button
              onClick={() => analyze.mutate(serviceId)}
              className="mt-3 text-sm text-red-600 hover:text-red-800 font-medium"
            >
              Erneut versuchen
            </button>
          </div>
        )}

        {analyze.data && (
          <div>
            <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {analyze.data.diagnosis}
            </div>

            {/* Similar Cases */}
            {analyze.data.similar_cases.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Ähnliche bekannte Fälle
                </h3>
                <div className="space-y-2">
                  {analyze.data.similar_cases.map(c => (
                    <div
                      key={c.id}
                      className="text-xs bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-800"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-gray-400 dark:text-gray-500">
                          Ähnlichkeit: {Math.round(c.similarity * 100)}%
                        </span>
                        {c.confirmed && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                            Bestätigt
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 dark:text-gray-400">{c.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Feedback */}
            {!feedbackSent ? (
              <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">War diese Analyse hilfreich?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFeedback(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-green-50 dark:hover:bg-green-900/30 hover:border-green-200 dark:hover:border-green-700 hover:text-green-700"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" /> Ja, in Wissensdatenbank speichern
                  </button>
                  <button
                    onClick={() => setFeedbackSent(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-200 dark:hover:border-red-700 hover:text-red-700"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" /> Nein
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-400 dark:text-gray-500">Danke für das Feedback!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
