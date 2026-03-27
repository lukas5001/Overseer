// ── Enums ────────────────────────────────────────────────────────────────────

export type CheckStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' | 'NO_DATA'
export type StateType = 'SOFT' | 'HARD'
export type UserRole = 'super_admin' | 'tenant_admin' | 'tenant_operator' | 'tenant_viewer'
export type ChannelType = string
export type TwoFAMethod = 'none' | 'totp' | 'email'

// ── Tenant ───────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string
  name: string
  slug: string
  active: boolean
  settings?: Record<string, unknown>
  created_at: string
  updated_at?: string
}

export interface TenantCreate {
  name: string
  slug: string
}

export interface TenantUpdate {
  name?: string
  active?: boolean
}

export interface TenantStat {
  tenant_id: string
  tenant_name: string
  slug: string
  host_count: number
  service_count: number
  critical: number
  warning: number
  unknown: number
  no_data: number
}

export interface TenantDetail {
  collectors: CollectorSummary[]
  api_keys: ApiKeySummary[]
}

export interface TenantUsage {
  tenant_id: string
  hosts: { current: number; max: number }
  services: { current: number; max: number }
  collectors: { current: number; max: number }
  check_results_count: number
}

// ── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  tenant_id: string | null
  email: string
  display_name: string | null
  role: UserRole
  tenant_access: string
  active: boolean
  last_login_at: string | null
  two_fa_method: TwoFAMethod
  default_filter_id: string | null
  created_at: string
}

export interface UserPreferences {
  show_inactive?: boolean
  polling_interval?: number
  default_filter_id?: string | null
}

// ── API Key ──────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  tenant_id: string
  name: string
  key_prefix: string
  active: boolean
  last_used_at: string | null
  created_at: string
}

export interface ApiKeySummary {
  id: string
  name: string
  key_prefix: string
  last_used_at: string | null
}

export interface ApiKeyCreateResponse {
  id: string
  name: string
  api_key: string // full key, shown once
}

// ── Collector ────────────────────────────────────────────────────────────────

export interface Collector {
  id: string
  tenant_id: string
  name: string
  hostname: string | null
  ip_address: string | null
  active: boolean
  last_seen_at: string | null
  config_version: number | null
  created_at: string
  updated_at?: string
  offline?: boolean
}

export interface CollectorSummary {
  id: string
  name: string
  hostname: string | null
  last_seen_at: string | null
}

export interface CollectorCreate {
  tenant_id: string
  name: string
  hostname?: string
  ip_address?: string
}

// ── Host ─────────────────────────────────────────────────────────────────────

export interface HostTypeConfig {
  id: string
  name: string
  icon: string
  category: string
  agent_capable: boolean
  snmp_enabled: boolean
  ip_required: boolean
  os_family: string | null
  sort_order: number
  is_system: boolean
  active: boolean
  created_at: string
}

export interface Host {
  id: string
  tenant_id: string
  collector_id: string | null
  hostname: string
  display_name: string | null
  ip_address: string | null
  host_type_id: string
  host_type_name: string | null
  host_type_icon: string | null
  host_type_agent_capable: boolean
  host_type_snmp_enabled: boolean
  host_type_ip_required: boolean
  snmp_community: string | null
  snmp_version: string | null
  tags: string[]
  agent_managed: boolean
  active: boolean
  created_at: string
  tenant_name?: string
  tenant_active?: boolean
  collector_offline?: boolean
}

export interface AgentTokenInfo {
  active: boolean
  last_seen_at: string | null
  agent_version: string | null
  agent_os: string | null
  created_at: string
}

export interface HostCreate {
  tenant_id: string
  collector_id?: string
  hostname: string
  display_name?: string
  ip_address?: string
  host_type_id: string
  snmp_community?: string
  snmp_version?: string
  tags?: string[]
}

export interface HostUpdate {
  hostname?: string
  display_name?: string
  ip_address?: string
  host_type_id?: string
  snmp_community?: string
  snmp_version?: string
  tags?: string[]
  collector_id?: string
  active?: boolean
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface Service {
  id: string
  host_id: string
  tenant_id: string
  name: string
  check_type: string
  check_config: Record<string, unknown>
  interval_seconds: number
  threshold_warn: number | null
  threshold_crit: number | null
  max_check_attempts: number
  check_mode: 'passive' | 'active' | 'agent'
  active: boolean
  created_at: string
}

export interface ServiceCreate {
  host_id: string
  tenant_id: string
  name: string
  check_type: string
  check_config?: Record<string, unknown>
  interval_seconds?: number
  threshold_warn?: number
  threshold_crit?: number
  max_check_attempts?: number
  check_mode?: string
}

export interface ServiceUpdate {
  name?: string
  check_config?: Record<string, unknown>
  interval_seconds?: number
  threshold_warn?: number
  threshold_crit?: number
  max_check_attempts?: number
  check_mode?: string
  active?: boolean
}

// ── CurrentStatus ────────────────────────────────────────────────────────────

export interface CurrentStatus {
  service_id: string
  host_id: string
  tenant_id: string
  status: CheckStatus
  state_type: StateType
  current_attempt: number
  status_message: string | null
  value: number | null
  unit: string | null
  last_check_at: string | null
  last_state_change_at: string | null
  acknowledged: boolean
  in_downtime: boolean
  host_hostname?: string
  host_display_name?: string | null
  host_type_name?: string
  host_type_icon?: string
  service_name?: string | null
  tenant_name?: string
}

// ── Error Overview ───────────────────────────────────────────────────────────

export interface ErrorOverviewItem {
  service_id: string
  host_id: string
  tenant_id: string
  tenant_name: string
  host_hostname: string
  host_display_name: string | null
  host_type_name: string | null
  host_type_icon: string | null
  service_name: string
  check_type: string
  status: 'WARNING' | 'CRITICAL' | 'UNKNOWN' | 'NO_DATA'
  state_type: StateType
  status_message: string | null
  value: number | null
  unit: string | null
  last_check_at: string | null
  last_state_change_at: string | null
  duration_seconds: number | null
  acknowledged: boolean
  acknowledged_by: string | null
  acknowledged_at: string | null
  acknowledge_comment: string | null
  in_downtime: boolean
}

// ── Status Summary ───────────────────────────────────────────────────────────

export interface StatusSummary {
  ok: number
  warning: number
  critical: number
  unknown: number
  no_data: number
  total: number
}

export interface TenantStatusSummary {
  tenant_id: string
  tenant_name: string
  total: number
  ok: number
  warning: number
  critical: number
  unknown: number
  no_data: number
}

// ── History / Time Series ────────────────────────────────────────────────────

export interface HistoryBucket {
  bucket: string
  avg_value: number | null
  min_value: number | null
  max_value: number | null
  check_count: number
  status_ok_pct: number | null
}

export interface HistoryPoint {
  time: string
  status: CheckStatus
  value: number | null
  unit: string | null
  message: string | null
}

export interface HistorySummary {
  min_value: number | null
  max_value: number | null
  avg_value: number | null
  ok_count: number
  warning_count: number
  critical_count: number
  unknown_count: number
  no_data_count: number
}

// ── SLA ──────────────────────────────────────────────────────────────────────

export interface ServiceSla {
  service_id: string
  sla_pct: number | null
  total_checks: number
  ok_checks: number
  start: string
  end: string
  uptime_minutes: number
  downtime_minutes: number
}

export interface TenantSlaReport {
  tenant_id: string
  period: { start: string; end: string }
  services: ServiceSlaSummary[]
}

export interface ServiceSlaSummary {
  service_id: string
  service_name: string
  host_name: string
  sla_pct: number | null
  uptime_minutes: number
  downtime_minutes: number
}

// ── Alert Rules ──────────────────────────────────────────────────────────────

export interface AlertConditions {
  statuses: CheckStatus[]
  min_duration_minutes: number
  host_tags: string[]
  service_names: string[]
}

export interface AlertRule {
  id: string
  tenant_id: string
  name: string
  conditions: AlertConditions
  notification_channels: string[]
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AlertRuleCreate {
  tenant_id: string
  name: string
  conditions: AlertConditions
  notification_channels: string[]
  enabled?: boolean
}

export interface AlertRuleUpdate {
  name?: string
  conditions?: Partial<AlertConditions>
  notification_channels?: string[]
  enabled?: boolean
}

// ── Alert Grouping ──────────────────────────────────────────────────────

export interface GroupingSettings {
  enabled: boolean
  group_by: 'host' | 'host_severity' | 'service_template'
  group_wait_seconds: number
  group_interval_seconds: number
  repeat_interval_seconds: number
}

// ── Active Alerts ────────────────────────────────────────────────────────────

export interface ActiveAlert {
  id: string
  service_id: string
  rule_id: string
  tenant_id: string
  fired_at: string
  last_notified_at: string
  resolved_at: string | null
  escalation_step: number
}

// ── Escalation Policy ────────────────────────────────────────────────────────

export interface EscalationStep {
  delay_minutes: number
  channels: string[]
}

export interface EscalationPolicy {
  id: string
  rule_id: string
  steps: EscalationStep[]
  created_at: string
}

export interface EscalationPolicyCreate {
  steps: EscalationStep[]
}

// ── Notification Channel ─────────────────────────────────────────────────────

export interface NotificationChannel {
  id: string
  tenant_id: string
  name: string
  channel_type: ChannelType
  config: Record<string, unknown>
  events: string[]
  active: boolean
  consecutive_failures: number
  last_failure_at: string | null
  last_failure_reason: string | null
  created_at: string
  updated_at: string
}

export interface NotificationChannelTypeInfo {
  channel_type: string
  display_name: string
  config_schema: {
    type: string
    properties: Record<string, {
      type: string
      title?: string
      description?: string
      format?: string
      default?: unknown
    }>
    required?: string[]
  }
}

export interface NotificationLogEntry {
  id: string
  tenant_id: string
  channel_id: string | null
  channel_type: string
  notification_type: string
  host_name: string | null
  service_name: string | null
  status: string
  success: boolean
  error_message: string | null
  sent_at: string
}

export interface ChannelCreate {
  tenant_id: string
  name: string
  channel_type: ChannelType
  config: Record<string, unknown>
  events?: string[]
}

export interface ChannelUpdate {
  name?: string
  config?: Record<string, unknown>
  events?: string[]
  active?: boolean
}

// ── Downtime ─────────────────────────────────────────────────────────────────

export interface Downtime {
  id: string
  tenant_id: string
  host_id: string | null
  service_id: string | null
  start_at: string
  end_at: string
  author_id: string | null
  comment: string | null
  active: boolean
  created_at: string
  recurrence: string | null
  parent_downtime_id: string | null
}

export interface DowntimeCreate {
  host_id?: string
  service_id?: string
  start_at: string
  end_at: string
  comment?: string
  recurrence?: string
}

// ── Service Template ─────────────────────────────────────────────────────────

export interface TemplateCheckItem {
  name: string
  check_type: string
  check_config?: Record<string, unknown>
  interval_seconds?: number
  threshold_warn?: number | null
  threshold_crit?: number | null
  check_mode?: string
}

export interface ServiceTemplate {
  id: string
  name: string
  description: string | null
  checks: TemplateCheckItem[]
  created_at: string
  updated_at?: string
}

export interface ServiceTemplateCreate {
  name: string
  description?: string
  checks: TemplateCheckItem[]
}

export interface ServiceTemplateUpdate {
  name?: string
  description?: string
  checks?: TemplateCheckItem[]
}

export interface TemplateApplyRequest {
  host_id: string
  overrides?: Record<string, unknown>
}

export interface TemplateApplyResponse {
  created: number
  skipped: number
}

// ── Saved Filter ─────────────────────────────────────────────────────────────

export interface SavedFilter {
  id: string
  name: string
  description: string | null
  filter_config: Record<string, unknown>
  created_by: string
  created_at: string
}

// ── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string
  tenant_id: string | null
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

// ── State History ────────────────────────────────────────────────────────────

export interface StateHistory {
  id: string
  service_id: string
  tenant_id: string
  previous_status: CheckStatus | null
  new_status: CheckStatus
  state_type: StateType
  message: string | null
  created_at: string
}

// ── AI ──────────────────────────────────────────────────────────────────────

export interface AiAnalysisResponse {
  service_id: string
  service_name: string
  diagnosis: string
  similar_cases: AiSimilarCase[]
}

export interface AiSimilarCase {
  id: string
  content: string
  source: string
  confirmed: boolean
  similarity: number
}

export interface AiQueryRequest {
  question: string
  tenant_id: string
  context_host_id?: string
}

export interface AiQueryResponse {
  question: string
  answer: string
  data: Record<string, unknown>[]
  sql_used: string
}

// ── Monitoring Script ────────────────────────────────────────────────────────

export interface MonitoringScript {
  id: string
  tenant_id: string
  name: string
  description: string
  interpreter: 'powershell' | 'bash' | 'python'
  script_body: string
  expected_output: 'nagios' | 'text' | 'json'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MonitoringScriptCreate {
  tenant_id: string
  name: string
  description?: string
  interpreter: string
  script_body: string
  expected_output?: string
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in: number
  requires_2fa?: boolean
  two_fa_method?: string
  pending_token?: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}
