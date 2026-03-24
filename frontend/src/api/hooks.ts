import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  StatusSummary, TenantStatusSummary, ErrorOverviewItem,
  Host, HostCreate, HostUpdate, CurrentStatus,
  Service, ServiceCreate, ServiceUpdate,
  Tenant, TenantCreate, TenantUpdate, TenantStat, TenantDetail, TenantUsage,
  Collector, CollectorCreate,
  AlertRule, AlertRuleCreate, AlertRuleUpdate, EscalationPolicy, EscalationPolicyCreate,
  NotificationChannel, ChannelCreate, ChannelUpdate,
  Downtime, DowntimeCreate,
  ServiceTemplate, ServiceTemplateCreate, ServiceTemplateUpdate, TemplateApplyRequest, TemplateApplyResponse,
  HistoryBucket, HistoryPoint, HistorySummary, ServiceSla, TenantSlaReport,
  AuditLog, User, ApiKeyCreateResponse,
  AiAnalysisResponse, AiQueryRequest, AiQueryResponse,
} from '../types'

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
