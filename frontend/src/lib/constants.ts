import { Server, Router, Printer, Shield, Wifi } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const HOST_TYPES = ['server', 'switch', 'router', 'printer', 'firewall', 'access_point', 'other'] as const

export const HOST_TYPE_LABELS: Record<string, string> = {
  server: 'Server',
  switch: 'Switch',
  router: 'Router',
  printer: 'Drucker',
  firewall: 'Firewall',
  access_point: 'Access Point',
  other: 'Sonstiges',
}

export const HOST_TYPE_ICONS: Record<string, LucideIcon> = {
  server: Server,
  switch: Router,
  router: Router,
  printer: Printer,
  firewall: Shield,
  access_point: Wifi,
}

export const NETWORK_DEVICE_TYPES = ['switch', 'router', 'printer', 'firewall', 'access_point', 'other'] as const
