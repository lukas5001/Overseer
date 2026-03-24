"""Overseer shared Pydantic schemas – used by Receiver, Worker, and API."""
from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ==================== Enums ====================

class CheckStatus(str, enum.Enum):
    OK = "OK"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


class StateType(str, enum.Enum):
    SOFT = "SOFT"
    HARD = "HARD"


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    TENANT_OPERATOR = "tenant_operator"
    TENANT_VIEWER = "tenant_viewer"


class HostType(str, enum.Enum):
    SERVER = "server"
    SWITCH = "switch"
    ROUTER = "router"
    PRINTER = "printer"
    FIREWALL = "firewall"
    ACCESS_POINT = "access_point"
    OTHER = "other"


# ==================== Check Result (from Collector) ====================

class SingleCheckResult(BaseModel):
    """A single check result as sent by the Collector."""
    host: str = Field(..., description="Hostname of the checked device")
    name: str = Field(..., description="Check name, e.g. 'cpu_usage', 'port_gi0/1'")
    status: CheckStatus
    value: float | None = None
    unit: str | None = None
    message: str | None = None
    check_type: str = Field(..., description="e.g. 'ping', 'snmp', 'ssh_disk', 'http'")
    perfdata: dict | None = None
    check_duration_ms: int | None = None


class CollectorPayload(BaseModel):
    """The complete payload sent by a Collector to the Receiver."""
    collector_id: str
    tenant_id: str
    timestamp: datetime
    checks: list[SingleCheckResult]


# ==================== API Response Models ====================

class TenantOut(BaseModel):
    id: UUID
    name: str
    slug: str
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CollectorOut(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    hostname: str | None
    ip_address: str | None
    active: bool
    last_seen_at: datetime | None
    config_version: int
    created_at: datetime
    offline: bool = False  # True if last_seen_at > 3 minutes ago

    model_config = {"from_attributes": True}

    @field_validator("ip_address", mode="before")
    @classmethod
    def coerce_ip(cls, v):
        return str(v) if v is not None else None


class HostOut(BaseModel):
    id: UUID
    tenant_id: UUID
    collector_id: UUID | None
    hostname: str
    display_name: str | None
    ip_address: str | None
    host_type: HostType
    snmp_community: str | None = None
    snmp_version: str | None = None
    winrm_username: str | None = None
    winrm_password: str | None = None
    winrm_transport: str | None = "ntlm"
    winrm_port: int | None = 5986
    winrm_ssl: bool | None = True
    tags: list
    active: bool
    created_at: datetime
    tenant_name: str | None = None
    tenant_active: bool = True
    collector_offline: bool = False  # True if collector hasn't sent heartbeat recently

    model_config = {"from_attributes": True}

    @field_validator("ip_address", mode="before")
    @classmethod
    def coerce_ip(cls, v):
        return str(v) if v is not None else None


class ServiceOut(BaseModel):
    id: UUID
    host_id: UUID
    tenant_id: UUID
    name: str
    check_type: str
    check_config: dict
    interval_seconds: int
    threshold_warn: float | None
    threshold_crit: float | None
    max_check_attempts: int
    check_mode: str = "passive"
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CurrentStatusOut(BaseModel):
    service_id: UUID
    host_id: UUID
    tenant_id: UUID
    status: CheckStatus
    state_type: StateType
    current_attempt: int
    status_message: str | None
    value: float | None
    unit: str | None
    last_check_at: datetime | None
    last_state_change_at: datetime | None
    acknowledged: bool
    in_downtime: bool

    # Joined fields for convenience
    host_hostname: str | None = None
    host_display_name: str | None = None
    host_type: HostType | None = None
    service_name: str | None = None
    tenant_name: str | None = None

    model_config = {"from_attributes": True}


class ErrorOverviewItem(BaseModel):
    """A single item in the error overview dashboard."""
    service_id: UUID
    host_id: UUID
    tenant_id: UUID
    tenant_name: str
    host_hostname: str
    host_display_name: str | None
    host_type: HostType
    service_name: str
    check_type: str
    status: CheckStatus
    state_type: StateType
    status_message: str | None
    value: float | None
    unit: str | None
    last_check_at: datetime | None
    last_state_change_at: datetime | None
    duration_seconds: int | None = None
    acknowledged: bool
    acknowledged_by: str | None = None
    acknowledged_at: datetime | None = None
    acknowledge_comment: str | None = None
    in_downtime: bool


# ==================== Write / Create / Update Schemas ====================

class HostCreate(BaseModel):
    tenant_id: UUID
    collector_id: UUID | None = None
    hostname: str
    display_name: str | None = None
    ip_address: str | None = None
    host_type: HostType = HostType.SERVER
    snmp_community: str | None = None
    snmp_version: str = "2c"
    winrm_username: str | None = None
    winrm_password: str | None = None
    winrm_transport: str = "ntlm"
    winrm_port: int = 5986
    winrm_ssl: bool = True
    tags: list = []


class HostUpdate(BaseModel):
    hostname: str | None = None
    display_name: str | None = None
    ip_address: str | None = None
    host_type: HostType | None = None
    snmp_community: str | None = None
    snmp_version: str | None = None
    winrm_username: str | None = None
    winrm_password: str | None = None
    winrm_transport: str | None = None
    winrm_port: int | None = None
    winrm_ssl: bool | None = None
    tags: list | None = None
    collector_id: UUID | None = None
    active: bool | None = None

    model_config = {"extra": "ignore"}


class ServiceCreate(BaseModel):
    host_id: UUID
    tenant_id: UUID
    name: str
    check_type: str
    check_config: dict = {}
    interval_seconds: int = 60
    threshold_warn: float | None = None
    threshold_crit: float | None = None
    max_check_attempts: int = 3
    check_mode: str = "passive"


class ServiceUpdate(BaseModel):
    name: str | None = None
    check_config: dict | None = None
    interval_seconds: int | None = None
    threshold_warn: float | None = None
    threshold_crit: float | None = None
    max_check_attempts: int | None = None
    check_mode: str | None = None
    active: bool | None = None


class TenantCreate(BaseModel):
    name: str
    slug: str


class TenantUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None


# ==================== Service Templates ====================

class TemplateCheckItem(BaseModel):
    name: str
    check_type: str
    check_config: dict = {}
    interval_seconds: int = 60
    threshold_warn: float | None = None
    threshold_crit: float | None = None
    check_mode: str = "active"


class ServiceTemplateOut(BaseModel):
    id: UUID
    name: str
    description: str
    checks: list[TemplateCheckItem]
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("checks", mode="before")
    @classmethod
    def parse_checks(cls, v):
        if isinstance(v, list) and all(isinstance(i, dict) for i in v):
            return [TemplateCheckItem(**i) for i in v]
        return v


class ServiceTemplateCreate(BaseModel):
    name: str
    description: str = ""
    checks: list[TemplateCheckItem] = []


class ServiceTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    checks: list[TemplateCheckItem] | None = None


# ==================== Auth ====================

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class LoginResponse(BaseModel):
    """Unified login response. Check requires_2fa to determine flow."""
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    requires_2fa: bool = False
    two_fa_method: str | None = None
    pending_token: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class TwoFAVerifyRequest(BaseModel):
    code: str
