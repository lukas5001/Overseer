import { useParams } from 'react-router-dom'
import { Server } from 'lucide-react'

export default function HostDetailPage() {
  const { hostId } = useParams()

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-8">
        <Server className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Host Details</h1>
      </div>

      <p className="text-gray-500">Host ID: {hostId}</p>

      {/* TODO: Implement host detail view with:
        - Host info (hostname, IP, type, tags)
        - All services with current status
        - Performance graphs (TimescaleDB queries)
        - State change history
        - Active downtimes
      */}
    </div>
  )
}
