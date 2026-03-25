import {
  Server, Monitor, Router, Printer, Shield, Wifi, Box,
  Network, HardDrive, Camera, Cloud, Database, Globe, Cpu, Laptop, Smartphone,
  type LucideIcon,
} from 'lucide-react'

/** Map icon name (from DB) to Lucide component */
const ICON_MAP: Record<string, LucideIcon> = {
  server: Server,
  monitor: Monitor,
  router: Router,
  printer: Printer,
  shield: Shield,
  wifi: Wifi,
  box: Box,
  network: Network,
  'hard-drive': HardDrive,
  camera: Camera,
  cloud: Cloud,
  database: Database,
  globe: Globe,
  cpu: Cpu,
  laptop: Laptop,
  smartphone: Smartphone,
}

/** Available icon names for the icon picker */
export const AVAILABLE_ICONS = Object.keys(ICON_MAP)

/** Resolve a host type icon name to a Lucide component */
export function getHostTypeIcon(iconName: string | null | undefined): LucideIcon {
  return (iconName && ICON_MAP[iconName]) || Server
}
