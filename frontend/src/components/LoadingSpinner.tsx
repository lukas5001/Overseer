import clsx from 'clsx'

interface LoadingSpinnerProps {
  className?: string
  text?: string
}

export default function LoadingSpinner({ className, text = 'Lade…' }: LoadingSpinnerProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center py-12 text-gray-400', className)}>
      <div className="w-8 h-8 border-2 border-gray-200 border-t-overseer-500 rounded-full animate-spin mb-3" />
      <p className="text-sm">{text}</p>
    </div>
  )
}
