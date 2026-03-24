/** Central date/time formatting – always Europe/Rome timezone. */

const TZ = 'Europe/Rome'

/** Full date+time: "21.03.2026, 14:30:00" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-DE', { timeZone: TZ })
}

/** Date only: "21.03.2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('de-DE', { timeZone: TZ })
}

/** Time only: "14:30" */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleTimeString('de-DE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
}
