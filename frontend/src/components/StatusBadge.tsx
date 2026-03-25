import { CheckCircle, AlertTriangle, XCircle, HelpCircle, CircleDashed, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'

type Status = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' | 'NO_DATA'

interface StatusDef {
  icon: LucideIcon
  dot: string
  bg: string
  text: string
  color: string
  border: string
  label: string
}

export const STATUS_CONFIG: Record<Status, StatusDef> = {
  OK:       { icon: CheckCircle,   dot: 'bg-emerald-500', bg: 'bg-emerald-100', text: 'text-emerald-800', color: 'text-emerald-500', border: 'border-emerald-300', label: 'OK' },
  WARNING:  { icon: AlertTriangle, dot: 'bg-amber-400',   bg: 'bg-amber-100',   text: 'text-amber-800',   color: 'text-amber-500',   border: 'border-amber-300',   label: 'WARNING' },
  CRITICAL: { icon: XCircle,       dot: 'bg-red-500',     bg: 'bg-red-100',     text: 'text-red-800',     color: 'text-red-500',     border: 'border-red-300',     label: 'CRITICAL' },
  UNKNOWN:  { icon: HelpCircle,    dot: 'bg-gray-400',    bg: 'bg-gray-100',    text: 'text-gray-700',    color: 'text-gray-400',    border: 'border-gray-300',    label: 'UNKNOWN' },
  NO_DATA:  { icon: CircleDashed,  dot: 'bg-orange-400',  bg: 'bg-orange-100',  text: 'text-orange-800',  color: 'text-orange-500',  border: 'border-orange-300',  label: 'NO DATA' },
}

export function getStatusConfig(status: string): StatusDef {
  return STATUS_CONFIG[status as Status] ?? STATUS_CONFIG.UNKNOWN
}

interface StatusBadgeProps {
  status: string
  variant?: 'badge' | 'dot' | 'text'
  showIcon?: boolean
  className?: string
}

export default function StatusBadge({ status, variant = 'badge', showIcon = false, className }: StatusBadgeProps) {
  const cfg = getStatusConfig(status)
  const Icon = cfg.icon

  if (variant === 'dot') {
    return (
      <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', cfg.text, className)}>
        <span className={clsx('w-2 h-2 rounded-full', cfg.dot)} />
        {cfg.label}
      </span>
    )
  }

  if (variant === 'text') {
    return <span className={clsx('font-bold', cfg.color, className)}>{cfg.label}</span>
  }

  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold', cfg.bg, cfg.text, className)}>
      {showIcon && <Icon className="w-3 h-3" />}
      {cfg.label}
    </span>
  )
}
