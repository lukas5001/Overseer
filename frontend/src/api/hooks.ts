import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  StatusSummary, TenantStatusSummary, ErrorOverviewItem,
  Host, HostCreate, HostUpdate, CurrentStatus,
  Service, ServiceCreate, ServiceUpdate,
  Tenant, TenantCreate, TenantUpdate, TenantStat, TenantDetail, TenantUsage,
  Collector, CollectorCreate,
  AlertRule, AlertRuleCreate, AlertRuleUpdate, EscalationPolicy, EscalationPolicyCreate,
  NotificationChannel, ChannelCreate, ChannelUpdate, NotificationChannelTypeInfo, NotificationLogEntry,
  Downtime, DowntimeCreate,
  ServiceTemplate, ServiceTemplateCreate, ServiceTemplateUpdate, TemplateApplyRequest, TemplateApplyResponse,
  HistoryBucket, HistoryPoint, HistorySummary, ServiceSla, TenantSlaReport,
  AuditLog, User, ApiKeyCreateResponse,
  AiAnalysisResponse, AiQueryRequest, AiQueryResponse,
  DashboardSummary, DashboardFull, DashboardVersion, DashboardShareConfig,
  DashboardQueryRequest, DashboardQueryResponse,
  MetaHost, MetaService,
  ReportSchedule, ReportScheduleCreate, ReportScheduleUpdate,
  ReportDelivery, ReportGenerateRequest,
  StatusPage, StatusPageCreate, StatusPageUpdate,
  StatusPageIncident, StatusPageSubscriber, PublicStatusPageData,
  LogSearchParams, LogSearchResponse, LogStats, LogSource,
} from '../types'
import axios from 'axios'

// Unauthenticated client for public endpoints
const publicApi = axios.create({ baseURL: '', headers: { 'Content-Type': 'application/json' } })

// ── Status ───────────────────────────────────────────────────────────────────

export function useStatusSummary() {
  return useQuery<StatusSummary>({
    queryKey: ['status-summary'],
    queryFn: () => api.get('/api/v1/status/summary').then(r => r.data),
  })
}

export function useStatusByTenant() {
  return useQuery<TenantStatusSummary[]>({
    queryKey: ['status-by-tenant'],
    queryFn: () => api.get('/api/v1/status/summary/by-tenant').then(r => r.data),
  })
}

export function useErrorOverview(params?: {
  tenant_id?: string
  statuses?: string
  acknowledged?: boolean
  include_downtime?: boolean
  limit?: number
  offset?: number
}) {
  return useQuery<ErrorOverviewItem[]>({
    queryKey: ['error-overview', params],
    queryFn: () => api.get('/api/v1/status/errors', { params }).then(r => r.data),
    refetchInterval: 15_000,
  })
}

export function useHostStatus(hostId?: string) {
  return useQuery<CurrentStatus[]>({
    queryKey: ['host-status', hostId],
    queryFn: () => api.get(`/api/v1/status/host/${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })
}

export function useAcknowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ serviceId, comment }: { serviceId: string; comment?: string }) =>
      api.post(`/api/v1/status/acknowledge/${serviceId}`, { comment: comment ?? '' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['error-overview'] })
      qc.invalidateQueries({ queryKey: ['host-status'] })
    },
  })
}

export function useUnacknowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (serviceId: string) => api.delete(`/api/v1/status/acknowledge/${serviceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['error-overview'] })
      qc.invalidateQueries({ queryKey: ['host-status'] })
    },
  })
}

export function useBulkAcknowledge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { service_ids: string[]; comment: string }) =>
      api.post('/api/v1/status/bulk-acknowledge', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['error-overview'] }),
  })
}

// ── Hosts ────────────────────────────────────────────────────────────────────

export function useHosts(params?: { tenant_id?: string; limit?: number; offset?: number }) {
  return useQuery<Host[]>({
    queryKey: ['hosts', params],
    queryFn: () => api.get('/api/v1/hosts/', { params }).then(r => r.data),
  })
}

export function useHost(hostId?: string) {
  return useQuery<Host>({
    queryKey: ['host', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })
}

export function useHostServicesSummary(hostId?: string) {
  return useQuery({
    queryKey: ['host-services-summary', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}/services/summary`).then(r => r.data),
    enabled: !!hostId,
  })
}

export function useCreateHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: HostCreate) => api.post('/api/v1/hosts/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  })
}

export function useUpdateHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: HostUpdate & { id: string }) =>
      api.patch(`/api/v1/hosts/${id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosts'] })
      qc.invalidateQueries({ queryKey: ['host'] })
    },
  })
}

export function useDeleteHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/hosts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  })
}

// ── Services ─────────────────────────────────────────────────────────────────

export function useServices(params?: { host_id?: string; tenant_id?: string }) {
  return useQuery<Service[]>({
    queryKey: ['services', params],
    queryFn: () => api.get('/api/v1/services/', { params }).then(r => r.data),
    enabled: !!params?.host_id || !!params?.tenant_id,
  })
}

export function useCreateService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ServiceCreate) => api.post('/api/v1/services/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })
}

export function useUpdateService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ServiceUpdate & { id: string }) =>
      api.patch(`/api/v1/services/${id}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })
}

export function useDeleteService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/services/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })
}

export function useCheckNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (serviceId: string) => api.post(`/api/v1/services/${serviceId}/check-now`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['host-status'] })
      qc.invalidateQueries({ queryKey: ['error-overview'] })
    },
  })
}

// ── Service History ──────────────────────────────────────────────────────────

export function useServiceHistoryBuckets(serviceId?: string, params?: {
  start?: string; end?: string; interval?: '1h' | '6h' | '1d'
}) {
  return useQuery<HistoryBucket[]>({
    queryKey: ['service-history-buckets', serviceId, params],
    queryFn: () => api.get(`/api/v1/services/${serviceId}/history`, { params }).then(r => r.data),
    enabled: !!serviceId,
    refetchInterval: false,
  })
}

export function useServiceHistoryRaw(serviceId?: string, hours = 24) {
  return useQuery<HistoryPoint[]>({
    queryKey: ['service-history-raw', serviceId, hours],
    queryFn: () => api.get(`/api/v1/history/${serviceId}`, { params: { hours } }).then(r => r.data),
    enabled: !!serviceId,
    refetchInterval: false,
  })
}

export function useServiceHistorySummary(serviceId?: string, hours = 24) {
  return useQuery<HistorySummary>({
    queryKey: ['service-history-summary', serviceId, hours],
    queryFn: () => api.get(`/api/v1/history/${serviceId}/summary`, { params: { hours } }).then(r => r.data),
    enabled: !!serviceId,
    refetchInterval: false,
  })
}

// ── SLA ──────────────────────────────────────────────────────────────────────

export function useServiceSla(serviceId?: string, start?: string, end?: string) {
  return useQuery<ServiceSla>({
    queryKey: ['service-sla', serviceId, start, end],
    queryFn: () => api.get(`/api/v1/sla/services/${serviceId}/sla`, { params: { start, end } }).then(r => r.data),
    enabled: !!serviceId,
    refetchInterval: false,
  })
}

export function useTenantSlaReport(tenantId?: string, start?: string, end?: string) {
  return useQuery<TenantSlaReport>({
    queryKey: ['tenant-sla', tenantId, start, end],
    queryFn: () => api.get(`/api/v1/sla/tenants/${tenantId}/sla-report`, { params: { start, end } }).then(r => r.data),
    enabled: !!tenantId && !!start && !!end,
    refetchInterval: false,
  })
}

// ── Tenants ──────────────────────────────────────────────────────────────────

export function useTenants() {
  return useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })
}

export function useTenantStats() {
  return useQuery<TenantStat[]>({
    queryKey: ['tenant-stats'],
    queryFn: () => api.get('/api/v1/tenants/stats').then(r => r.data),
  })
}

export function useTenantDetail(tenantId?: string) {
  return useQuery<TenantDetail>({
    queryKey: ['tenant-detail', tenantId],
    queryFn: () => api.get(`/api/v1/tenants/${tenantId}/detail`).then(r => r.data),
    enabled: !!tenantId,
  })
}

export function useTenantUsage(tenantId?: string) {
  return useQuery<TenantUsage>({
    queryKey: ['tenant-usage', tenantId],
    queryFn: () => api.get(`/api/v1/tenants/${tenantId}/usage`).then(r => r.data),
    enabled: !!tenantId,
  })
}

export function useCreateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TenantCreate) => api.post('/api/v1/tenants/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  })
}

export function useUpdateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: TenantUpdate & { id: string }) =>
      api.patch(`/api/v1/tenants/${id}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants'] })
      qc.invalidateQueries({ queryKey: ['tenant-stats'] })
    },
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation<ApiKeyCreateResponse, unknown, { tenantId: string; name: string }>({
    mutationFn: ({ tenantId, name }) =>
      api.post(`/api/v1/tenants/${tenantId}/api-keys`, { name }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-detail'] }),
  })
}

// ── Collectors ───────────────────────────────────────────────────────────────

export function useCollectors() {
  return useQuery<Collector[]>({
    queryKey: ['collectors'],
    queryFn: () => api.get('/api/v1/collectors/').then(r => r.data),
  })
}

export function useCreateCollector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CollectorCreate) => api.post('/api/v1/collectors/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collectors'] }),
  })
}

export function useDeleteCollector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/collectors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collectors'] }),
  })
}

// ── Alert Rules ──────────────────────────────────────────────────────────────

export function useAlertRules() {
  return useQuery<AlertRule[]>({
    queryKey: ['alert-rules'],
    queryFn: () => api.get('/api/v1/alert-rules/').then(r => r.data),
  })
}

export function useAlertRule(ruleId?: string) {
  return useQuery<AlertRule>({
    queryKey: ['alert-rule', ruleId],
    queryFn: () => api.get(`/api/v1/alert-rules/${ruleId}`).then(r => r.data),
    enabled: !!ruleId,
  })
}

export function useCreateAlertRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AlertRuleCreate) => api.post('/api/v1/alert-rules/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })
}

export function useUpdateAlertRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: AlertRuleUpdate & { id: string }) =>
      api.patch(`/api/v1/alert-rules/${id}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })
}

export function useDeleteAlertRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/alert-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })
}

export function useTestAlertRule() {
  return useMutation({
    mutationFn: (ruleId: string) => api.post(`/api/v1/alert-rules/${ruleId}/test`),
  })
}

export function useEscalationPolicy(ruleId?: string) {
  return useQuery<EscalationPolicy>({
    queryKey: ['escalation', ruleId],
    queryFn: () => api.get(`/api/v1/alert-rules/${ruleId}/escalation`).then(r => r.data),
    enabled: !!ruleId,
  })
}

export function useSaveEscalation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId, ...body }: EscalationPolicyCreate & { ruleId: string }) =>
      api.put(`/api/v1/alert-rules/${ruleId}/escalation`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['escalation'] }),
  })
}

// ── Notification Channels ────────────────────────────────────────────────────

export function useNotificationChannels() {
  return useQuery<NotificationChannel[]>({
    queryKey: ['notification-channels'],
    queryFn: () => api.get('/api/v1/notifications/').then(r => r.data),
  })
}

export function useChannelTypes() {
  return useQuery<NotificationChannelTypeInfo[]>({
    queryKey: ['notification-channel-types'],
    queryFn: () => api.get('/api/v1/notifications/types').then(r => r.data),
    staleTime: 300_000,
  })
}

export function useNotificationLog(params?: {
  channel_id?: string; success?: boolean; limit?: number; offset?: number
}) {
  return useQuery<NotificationLogEntry[]>({
    queryKey: ['notification-log', params],
    queryFn: () => api.get('/api/v1/notifications/log', { params }).then(r => r.data),
    refetchInterval: false,
  })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ChannelCreate) => api.post('/api/v1/notifications/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-channels'] }),
  })
}

export function useUpdateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ChannelUpdate & { id: string }) =>
      api.patch(`/api/v1/notifications/${id}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-channels'] }),
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-channels'] }),
  })
}

export function useTestChannel() {
  return useMutation({
    mutationFn: (channelId: string) => api.post(`/api/v1/notifications/${channelId}/test`),
  })
}

// ── Downtimes ────────────────────────────────────────────────────────────────

export function useDowntimes(params?: { tenant_id?: string; active_only?: boolean }) {
  return useQuery<Downtime[]>({
    queryKey: ['downtimes', params],
    queryFn: () => api.get('/api/v1/downtimes/', { params }).then(r => r.data),
  })
}

export function useCreateDowntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DowntimeCreate) => api.post('/api/v1/downtimes/', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['downtimes'] })
      qc.invalidateQueries({ queryKey: ['error-overview'] })
    },
  })
}

export function useDeleteDowntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/downtimes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['downtimes'] })
      qc.invalidateQueries({ queryKey: ['error-overview'] })
    },
  })
}

// ── Service Templates ────────────────────────────────────────────────────────

export function useServiceTemplates() {
  return useQuery<ServiceTemplate[]>({
    queryKey: ['service-templates'],
    queryFn: () => api.get('/api/v1/service-templates/').then(r => r.data),
  })
}

export function useServiceTemplate(templateId?: string) {
  return useQuery<ServiceTemplate>({
    queryKey: ['service-template', templateId],
    queryFn: () => api.get(`/api/v1/service-templates/${templateId}`).then(r => r.data),
    enabled: !!templateId,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ServiceTemplateCreate) => api.post('/api/v1/service-templates/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-templates'] }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ServiceTemplateUpdate & { id: string }) =>
      api.put(`/api/v1/service-templates/${id}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-templates'] }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/service-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-templates'] }),
  })
}

export function useApplyTemplate() {
  const qc = useQueryClient()
  return useMutation<TemplateApplyResponse, unknown, { templateId: string } & TemplateApplyRequest>({
    mutationFn: ({ templateId, ...body }) =>
      api.post(`/api/v1/service-templates/${templateId}/apply`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })
}

// ── Admin ────────────────────────────────────────────────────────────────────

export function useExportConfig() {
  return useMutation({
    mutationFn: () => api.get('/api/v1/admin/export').then(r => r.data),
  })
}

export function useImportConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post('/api/v1/admin/import', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries()
    },
  })
}

// ── Audit Log ────────────────────────────────────────────────────────────────

export function useAuditLogs(params?: {
  limit?: number; offset?: number; actor_email?: string; action?: string
}) {
  return useQuery<AuditLog[]>({
    queryKey: ['audit-logs', params],
    queryFn: () => api.get('/api/v1/audit/', { params }).then(r => r.data),
    refetchInterval: false,
  })
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function useCurrentUser() {
  return useQuery<User>({
    queryKey: ['current-user'],
    queryFn: () => api.get('/api/v1/auth/me').then(r => r.data),
    refetchInterval: false,
    staleTime: 60_000,
  })
}

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users/').then(r => r.data),
  })
}

// ── AI ──────────────────────────────────────────────────────────────────────

export function useAiAnalyze() {
  return useMutation<AiAnalysisResponse, unknown, string>({
    mutationFn: (serviceId: string) =>
      api.post(`/ai/analyze/${serviceId}`).then(r => r.data),
  })
}

export function useAiQuery() {
  return useMutation<AiQueryResponse, unknown, AiQueryRequest>({
    mutationFn: (body: AiQueryRequest) =>
      api.post('/ai/query/', body).then(r => r.data),
  })
}

export function useAiAddKnowledge() {
  return useMutation({
    mutationFn: (body: { content: string; tenant_id: string; service_id?: string }) =>
      api.post('/ai/knowledge/', body).then(r => r.data),
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getRole(): string | null {
  try {
    const token = localStorage.getItem('overseer_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.role ?? null
  } catch {
    return null
  }
}

export function getTenantId(): string | null {
  try {
    const token = localStorage.getItem('overseer_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.tenant_id ?? null
  } catch {
    return null
  }
}

// ── Dashboards ──────────────────────────────────────────────────────────────

export function useDashboards(tenantId?: string) {
  return useQuery<DashboardSummary[]>({
    queryKey: ['dashboards', tenantId],
    queryFn: () => api.get('/api/v1/dashboards/', { params: tenantId ? { tenant_id: tenantId } : {} }).then(r => r.data),
  })
}

export function useDashboard(id?: string) {
  return useQuery<DashboardFull>({
    queryKey: ['dashboard', id],
    queryFn: () => api.get(`/api/v1/dashboards/${id}`).then(r => r.data),
    enabled: !!id,
  })
}

export function useCreateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { tenant_id: string; title: string; description?: string }) =>
      api.post('/api/v1/dashboards/', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}

export function useUpdateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; description?: string; config?: Record<string, unknown> }) =>
      api.put(`/api/v1/dashboards/${id}`, body).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] })
      qc.invalidateQueries({ queryKey: ['dashboard', vars.id] })
    },
  })
}

export function useDeleteDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/dashboards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}

export function useDashboardVersions(id?: string) {
  return useQuery<DashboardVersion[]>({
    queryKey: ['dashboard-versions', id],
    queryFn: () => api.get(`/api/v1/dashboards/${id}/versions`).then(r => r.data),
    enabled: !!id,
  })
}

export function useRestoreDashboardVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post(`/api/v1/dashboards/${id}/restore/${version}`).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboard', vars.id] })
      qc.invalidateQueries({ queryKey: ['dashboard-versions', vars.id] })
    },
  })
}

// ── Dashboard Query + Meta ──────────────────────────────────────────────────

export function useDashboardQuery(
  query: DashboardQueryRequest | null,
  options?: { refetchInterval?: number; enabled?: boolean },
) {
  return useQuery<DashboardQueryResponse>({
    queryKey: ['dashboard-query', query],
    queryFn: () => api.post('/api/v1/dashboards/query', query).then(r => r.data),
    enabled: options?.enabled !== false && !!query,
    refetchInterval: options?.refetchInterval,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  })
}

export function useDashboardMetaHosts() {
  return useQuery<MetaHost[]>({
    queryKey: ['dashboard-meta-hosts'],
    queryFn: () => api.get('/api/v1/dashboards/meta/hosts').then(r => r.data),
    staleTime: 60_000,
  })
}

export function useDashboardMetaServices(hostId?: string) {
  return useQuery<MetaService[]>({
    queryKey: ['dashboard-meta-services', hostId],
    queryFn: () => api.get('/api/v1/dashboards/meta/services', {
      params: hostId ? { host_id: hostId } : {},
    }).then(r => r.data),
    staleTime: 60_000,
  })
}

export function useDashboardMetaCheckTypes() {
  return useQuery<string[]>({
    queryKey: ['dashboard-meta-check-types'],
    queryFn: () => api.get('/api/v1/dashboards/meta/check-types').then(r => r.data),
    staleTime: 60_000,
  })
}

// ── Dashboard Sharing ──────────────────────────────────────────────────────

export function useShareDashboard() {
  const qc = useQueryClient()
  return useMutation<
    { share_token: string; share_expires_at: string; share_config: DashboardShareConfig },
    unknown,
    { id: string; expires_in_days: number; fixed_variables?: string[]; fixed_variable_values?: Record<string, string | string[]> }
  >({
    mutationFn: ({ id, ...body }) =>
      api.post(`/api/v1/dashboards/${id}/share`, body).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['dashboard', vars.id] })
    },
  })
}

export function useRevokeDashboardShare() {
  const qc = useQueryClient()
  return useMutation<void, unknown, string>({
    mutationFn: (id) => api.delete(`/api/v1/dashboards/${id}/share`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['dashboard', id] })
    },
  })
}

// ── Public Dashboard (no auth) ─────────────────────────────────────────────

export function usePublicDashboard(shareToken?: string) {
  return useQuery<DashboardFull>({
    queryKey: ['public-dashboard', shareToken],
    queryFn: () => publicApi.get(`/api/v1/public/dashboards/${shareToken}`).then(r => r.data),
    enabled: !!shareToken,
  })
}

export function usePublicDashboardQuery(
  shareToken: string | undefined,
  query: DashboardQueryRequest | null,
  options?: { refetchInterval?: number; enabled?: boolean },
) {
  return useQuery<DashboardQueryResponse>({
    queryKey: ['public-dashboard-query', shareToken, query],
    queryFn: () => publicApi.post(`/api/v1/public/dashboards/${shareToken}/query`, query).then(r => r.data),
    enabled: options?.enabled !== false && !!shareToken && !!query,
    refetchInterval: options?.refetchInterval,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  })
}

export function usePublicStatusSummary(shareToken?: string) {
  return useQuery<StatusSummary>({
    queryKey: ['public-summary', shareToken],
    queryFn: () => publicApi.get(`/api/v1/public/dashboards/${shareToken}/summary`).then(r => r.data),
    enabled: !!shareToken,
    refetchInterval: 30_000,
  })
}

export function usePublicDashboardMetaHosts(shareToken?: string) {
  return useQuery<MetaHost[]>({
    queryKey: ['public-meta-hosts', shareToken],
    queryFn: () => publicApi.get(`/api/v1/public/dashboards/${shareToken}/meta/hosts`).then(r => r.data),
    enabled: !!shareToken,
    staleTime: 60_000,
  })
}

// ── Reports ─────────────────────────────────────────────────────────────────

export function useReportSchedules(tenantId?: string) {
  return useQuery<ReportSchedule[]>({
    queryKey: ['report-schedules', tenantId],
    queryFn: () => api.get('/api/v1/reports/schedules', { params: tenantId ? { tenant_id: tenantId } : {} }).then(r => r.data),
  })
}

export function useCreateReportSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ReportScheduleCreate) => api.post('/api/v1/reports/schedules', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  })
}

export function useUpdateReportSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ReportScheduleUpdate & { id: string }) =>
      api.patch(`/api/v1/reports/schedules/${id}`, body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  })
}

export function useDeleteReportSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/reports/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  })
}

export function useReportHistory(params?: { tenant_id?: string; schedule_id?: string; status?: string; limit?: number; offset?: number }) {
  return useQuery<ReportDelivery[]>({
    queryKey: ['report-history', params],
    queryFn: () => api.get('/api/v1/reports/history', { params }).then(r => r.data),
  })
}

export function useGenerateReport() {
  const qc = useQueryClient()
  return useMutation<ReportDelivery, unknown, ReportGenerateRequest>({
    mutationFn: (body) => api.post('/api/v1/reports/generate', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-history'] }),
  })
}

export function useResendReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (deliveryId: string) => api.post(`/api/v1/reports/resend/${deliveryId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-history'] }),
  })
}

export function useRetryReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (deliveryId: string) => api.post(`/api/v1/reports/retry/${deliveryId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-history'] }),
  })
}

// ── Status Pages ─────────────────────────────────────────────────────────────

export function useStatusPages() {
  return useQuery<StatusPage[]>({
    queryKey: ['status-pages'],
    queryFn: () => api.get('/api/v1/status-pages').then(r => r.data),
  })
}

export function useStatusPage(id?: string) {
  return useQuery<StatusPage>({
    queryKey: ['status-page', id],
    queryFn: () => api.get(`/api/v1/status-pages/${id}`).then(r => r.data),
    enabled: !!id,
  })
}

export function useCreateStatusPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: StatusPageCreate) => api.post('/api/v1/status-pages', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-pages'] }),
  })
}

export function useUpdateStatusPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StatusPageUpdate }) =>
      api.patch(`/api/v1/status-pages/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['status-pages'] })
      qc.invalidateQueries({ queryKey: ['status-page'] })
    },
  })
}

export function useDeleteStatusPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/status-pages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-pages'] }),
  })
}

export function useStatusPageIncidents(pageId?: string) {
  return useQuery<StatusPageIncident[]>({
    queryKey: ['status-page-incidents', pageId],
    queryFn: () => api.get(`/api/v1/status-pages/${pageId}/incidents`).then(r => r.data),
    enabled: !!pageId,
  })
}

export function useCreateIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, data }: { pageId: string; data: Record<string, unknown> }) =>
      api.post(`/api/v1/status-pages/${pageId}/incidents`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-page-incidents'] }),
  })
}

export function useAddIncidentUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, incidentId, data }: { pageId: string; incidentId: string; data: { status: string; body: string } }) =>
      api.post(`/api/v1/status-pages/${pageId}/incidents/${incidentId}/updates`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-page-incidents'] }),
  })
}

export function useAddComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, data }: { pageId: string; data: Record<string, unknown> }) =>
      api.post(`/api/v1/status-pages/${pageId}/components`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['status-pages'] })
      qc.invalidateQueries({ queryKey: ['status-page'] })
    },
  })
}

export function useUpdateComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, compId, data }: { pageId: string; compId: string; data: Record<string, unknown> }) =>
      api.patch(`/api/v1/status-pages/${pageId}/components/${compId}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['status-pages'] })
      qc.invalidateQueries({ queryKey: ['status-page'] })
    },
  })
}

export function useDeleteComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, compId }: { pageId: string; compId: string }) =>
      api.delete(`/api/v1/status-pages/${pageId}/components/${compId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['status-pages'] })
      qc.invalidateQueries({ queryKey: ['status-page'] })
    },
  })
}

export function usePublicStatusPage(slug?: string) {
  return useQuery<PublicStatusPageData>({
    queryKey: ['public-status-page', slug],
    queryFn: () => publicApi.get(`/api/v1/public/status/${slug}`).then(r => r.data),
    enabled: !!slug,
    refetchInterval: 60_000,
  })
}

export function useCreateMaintenance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, data }: { pageId: string; data: Record<string, unknown> }) =>
      api.post(`/api/v1/status-pages/${pageId}/maintenance`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-page-incidents'] }),
  })
}

export function useStatusPageSubscribers(pageId?: string) {
  return useQuery<StatusPageSubscriber[]>({
    queryKey: ['status-page-subscribers', pageId],
    queryFn: () => api.get(`/api/v1/status-pages/${pageId}/subscribers`).then(r => r.data),
    enabled: !!pageId,
  })
}

export function useDeleteSubscriber() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, subId }: { pageId: string; subId: string }) =>
      api.delete(`/api/v1/status-pages/${pageId}/subscribers/${subId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-page-subscribers'] }),
  })
}

export function usePublicSubscribe() {
  return useMutation({
    mutationFn: ({ slug, email, componentIds }: { slug: string; email: string; componentIds?: string[] }) =>
      publicApi.post(`/api/v1/public/status/${slug}/subscribe`, { email, component_ids: componentIds || [] }).then(r => r.data),
  })
}

export function usePublicDashboardMetaServices(shareToken?: string, hostId?: string) {
  return useQuery<MetaService[]>({
    queryKey: ['public-meta-services', shareToken, hostId],
    queryFn: () => publicApi.get(`/api/v1/public/dashboards/${shareToken}/meta/services`, {
      params: hostId ? { host_id: hostId } : {},
    }).then(r => r.data),
    enabled: !!shareToken,
    staleTime: 60_000,
  })
}

// ── Discovery ────────────────────────────────────────────────────────────────

import type { DiscoveryResult, DiscoveryScan, NetworkScanRequest, DiscoveryAddHostRequest, DiscoveryBulkAddRequest } from '../types'

export function useDiscoveryResults(params?: { status?: string; source?: string; device_type?: string; scan_id?: string; limit?: number; offset?: number }) {
  return useQuery<DiscoveryResult[]>({
    queryKey: ['discovery-results', params],
    queryFn: () => api.get('/api/v1/discovery/results', { params }).then(r => r.data),
  })
}

export function useDiscoveryScans(limit = 20) {
  return useQuery<DiscoveryScan[]>({
    queryKey: ['discovery-scans', limit],
    queryFn: () => api.get('/api/v1/discovery/scans', { params: { limit } }).then(r => r.data),
  })
}

export function useStartNetworkScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: NetworkScanRequest) =>
      api.post('/api/v1/discovery/network-scan', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discovery-scans'] })
      qc.invalidateQueries({ queryKey: ['discovery-results'] })
    },
  })
}

export function useAddDiscoveryHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ resultId, data }: { resultId: string; data: DiscoveryAddHostRequest }) =>
      api.post(`/api/v1/discovery/results/${resultId}/add`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discovery-results'] })
      qc.invalidateQueries({ queryKey: ['hosts'] })
    },
  })
}

export function useIgnoreDiscoveryResult() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (resultId: string) =>
      api.post(`/api/v1/discovery/results/${resultId}/ignore`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discovery-results'] }),
  })
}

export function useBulkAddDiscovery() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: DiscoveryBulkAddRequest) =>
      api.post('/api/v1/discovery/results/bulk-add', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discovery-results'] })
      qc.invalidateQueries({ queryKey: ['hosts'] })
    },
  })
}

export function useDiscoveryIgnored(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['discovery-ignored', params],
    queryFn: () => api.get('/api/v1/discovery/ignored', { params }).then(r => r.data),
  })
}

export function useUnignoreDiscoveryResult() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (resultId: string) =>
      api.delete(`/api/v1/discovery/ignored/${resultId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discovery-results'] })
      qc.invalidateQueries({ queryKey: ['discovery-ignored'] })
    },
  })
}

// ── Logs ────────────────────────────────────────────────────────────────────

export function useSearchLogs(params: LogSearchParams, enabled = true) {
  return useQuery<LogSearchResponse>({
    queryKey: ['logs-search', params],
    queryFn: () => api.post('/api/v1/logs/search', params).then(r => r.data),
    enabled,
  })
}

export function useLogStats(params?: { host_id?: string; hours?: number }) {
  return useQuery<LogStats>({
    queryKey: ['log-stats', params],
    queryFn: () => api.get('/api/v1/logs/stats', { params }).then(r => r.data),
  })
}

export function useLogSources(hostId?: string) {
  return useQuery<LogSource[]>({
    queryKey: ['log-sources', hostId],
    queryFn: () => api.get('/api/v1/logs/sources', { params: hostId ? { host_id: hostId } : {} }).then(r => r.data),
  })
}
