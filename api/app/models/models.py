"""SQLAlchemy ORM models – mirrors migrations/001_initial.sql."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer,
    String, Table, Text, UniqueConstraint, Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET, ARRAY
from sqlalchemy.orm import relationship

from api.app.core.database import Base

# ── Association table for multi-tenant user access ──────────────────────────
user_tenant_access = Table(
    "user_tenant_access",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("tenant_id", UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
)

# ── Enums (already created by migration, so create_type=False) ──────────────

CheckStatusEnum = SAEnum(
    "OK", "WARNING", "CRITICAL", "UNKNOWN", "NO_DATA",
    name="check_status", create_type=False,
)
StateTypeEnum = SAEnum("SOFT", "HARD", name="state_type", create_type=False)
UserRoleEnum = SAEnum(
    "super_admin", "tenant_admin", "tenant_operator", "tenant_viewer",
    name="user_role", create_type=False,
)


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)
    active = Column(Boolean, nullable=False, default=True)
    settings = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    collectors = relationship("Collector", back_populates="tenant", passive_deletes=True)
    hosts = relationship("Host", back_populates="tenant", passive_deletes=True)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    key_hash = Column(String(255), nullable=False)
    key_prefix = Column(String(12), nullable=False)
    name = Column(String(255), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    last_used_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=False)
    role = Column(UserRoleEnum, nullable=False, default="tenant_viewer")
    tenant_access = Column(String(20), nullable=False, default="selected")  # 'all' or 'selected'
    active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True))
    two_fa_method = Column(String(10), nullable=False, default="none")
    two_fa_secret = Column(Text, nullable=True)
    two_fa_email_code = Column(String(6), nullable=True)
    two_fa_email_code_expires_at = Column(DateTime(timezone=True), nullable=True)
    two_fa_email_code_hash = Column(Text, nullable=True)
    two_fa_attempts = Column(Integer, nullable=False, default=0)
    two_fa_lockout_until = Column(DateTime(timezone=True), nullable=True)
    default_filter_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    accessible_tenants = relationship("Tenant", secondary=user_tenant_access)


class Collector(Base):
    __tablename__ = "collectors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    hostname = Column(String(255))
    ip_address = Column(INET)
    active = Column(Boolean, nullable=False, default=True)
    last_seen_at = Column(DateTime(timezone=True))
    config_version = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant", back_populates="collectors")
    hosts = relationship("Host", back_populates="collector", passive_deletes=True)


class HostType(Base):
    __tablename__ = "host_types"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, unique=True)
    icon = Column(String(50), nullable=False, default="server")
    category = Column(String(100), nullable=False, default="Sonstiges")
    agent_capable = Column(Boolean, nullable=False, default=False)
    snmp_enabled = Column(Boolean, nullable=False, default=False)
    ip_required = Column(Boolean, nullable=False, default=False)
    os_family = Column(String(50), nullable=True)
    sort_order = Column(Integer, nullable=False, default=100)
    is_system = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class Host(Base):
    __tablename__ = "hosts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    collector_id = Column(UUID(as_uuid=True), ForeignKey("collectors.id", ondelete="SET NULL"), nullable=True)
    hostname = Column(String(255), nullable=False)
    display_name = Column(String(255))
    ip_address = Column(INET)
    host_type_id = Column(UUID(as_uuid=True), ForeignKey("host_types.id"), nullable=False)
    snmp_community = Column(String(255))
    snmp_version = Column(String(10), default="2c")
    tags = Column(JSONB, nullable=False, default=list)
    agent_managed = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint("tenant_id", "hostname"),)

    tenant = relationship("Tenant", back_populates="hosts")
    collector = relationship("Collector", back_populates="hosts")
    host_type = relationship("HostType")
    services = relationship("Service", back_populates="host", passive_deletes=True)


class Service(Base):
    __tablename__ = "services"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    host_id = Column(UUID(as_uuid=True), ForeignKey("hosts.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    check_type = Column(String(100), nullable=False)
    check_config = Column(JSONB, nullable=False, default=dict)
    interval_seconds = Column(Integer, nullable=False, default=60)
    threshold_warn = Column(Float)
    threshold_crit = Column(Float)
    max_check_attempts = Column(Integer, nullable=False, default=3)
    retry_interval_seconds = Column(Integer, nullable=False, default=15)
    check_mode = Column(String(10), nullable=False, default="passive")  # 'passive' or 'active'
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint("host_id", "name"),)

    host = relationship("Host", back_populates="services")
    current_status = relationship("CurrentStatus", back_populates="service", uselist=False)


class CurrentStatus(Base):
    __tablename__ = "current_status"

    service_id = Column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    host_id = Column(UUID(as_uuid=True), ForeignKey("hosts.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    status = Column(CheckStatusEnum, nullable=False, default="NO_DATA")
    state_type = Column(StateTypeEnum, nullable=False, default="SOFT")
    current_attempt = Column(Integer, nullable=False, default=0)
    status_message = Column(Text)
    value = Column(Float)
    unit = Column(String(50))
    last_check_at = Column(DateTime(timezone=True))
    last_state_change_at = Column(DateTime(timezone=True))
    acknowledged = Column(Boolean, nullable=False, default=False)
    acknowledged_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True))
    acknowledge_comment = Column(Text)
    in_downtime = Column(Boolean, nullable=False, default=False)

    service = relationship("Service", back_populates="current_status")
    host = relationship("Host")
    tenant = relationship("Tenant")


class StateHistory(Base):
    __tablename__ = "state_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id = Column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    previous_status = Column(CheckStatusEnum)
    new_status = Column(CheckStatusEnum, nullable=False)
    state_type = Column(StateTypeEnum, nullable=False)
    message = Column(Text)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_email = Column(String(255))
    action = Column(String(100), nullable=False)
    target_type = Column(String(50))
    target_id = Column(UUID(as_uuid=True))
    detail = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class Downtime(Base):
    __tablename__ = "downtimes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    host_id = Column(UUID(as_uuid=True), ForeignKey("hosts.id", ondelete="CASCADE"), nullable=True)
    service_id = Column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True), nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    comment = Column(Text)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    recurrence = Column(Text, nullable=True)
    parent_downtime_id = Column(UUID(as_uuid=True), ForeignKey("downtimes.id", ondelete="CASCADE"), nullable=True)


class ServiceTemplate(Base):
    __tablename__ = "service_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default="")
    checks = Column(JSONB, nullable=False, default=list)
    vendor = Column(String(100), nullable=False, default="generic")
    category = Column(String(100), nullable=False, default="server")
    built_in = Column(Boolean, nullable=False, default=False)
    tags = Column(ARRAY(String), nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    channel_type = Column(String(50), nullable=False, default="webhook")
    config = Column(JSONB, nullable=False, default=dict)
    events = Column(ARRAY(String), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    consecutive_failures = Column(Integer, nullable=False, default=0)
    last_failure_at = Column(DateTime(timezone=True), nullable=True)
    last_failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class NotificationLog(Base):
    __tablename__ = "notification_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    channel_id = Column(UUID(as_uuid=True), ForeignKey("notification_channels.id", ondelete="SET NULL"), nullable=True)
    channel_type = Column(String(50), nullable=False)
    notification_type = Column(String(20), nullable=False)
    host_name = Column(String(255), nullable=True)
    service_name = Column(String(255), nullable=True)
    status = Column(String(20), nullable=True)
    success = Column(Boolean, nullable=False)
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class SavedFilter(Base):
    __tablename__ = "saved_filters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    filter_config = Column(JSONB, nullable=False, default=dict)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))



class AlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    conditions = Column(JSONB, nullable=False, default=dict)
    notification_channels = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class ActiveAlert(Base):
    __tablename__ = "active_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id = Column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    fired_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    last_notified_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    escalation_step = Column(Integer, nullable=False, default=0)


class MonitoringScript(Base):
    __tablename__ = "monitoring_scripts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default="")
    interpreter = Column(String(20), nullable=False, default="powershell")
    script_body = Column(Text, nullable=False)
    expected_output = Column(String(20), nullable=False, default="nagios")
    created_by = Column(UUID(as_uuid=True), nullable=True)  # NO FK per convention
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint("tenant_id", "name"),)


class EscalationPolicy(Base):
    __tablename__ = "escalation_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, unique=True)
    steps = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class GlobalCheckPolicy(Base):
    __tablename__ = "global_check_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    check_type = Column(String(100), nullable=False)
    merge_config = Column(JSONB, nullable=False, default=dict)
    merge_strategy = Column(String(20), nullable=False, default="merge")
    scope_mode = Column(String(20), nullable=False, default="all")
    scope_tenant_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    priority = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class Dashboard(Base):
    __tablename__ = "dashboards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    config = Column(JSONB, nullable=False, default=dict)
    is_default = Column(Boolean, nullable=False, default=False)
    is_shared = Column(Boolean, nullable=False, default=False)
    share_token = Column(String(64), unique=True, nullable=True)
    share_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    versions = relationship("DashboardVersion", back_populates="dashboard", passive_deletes=True)


class DashboardVersion(Base):
    __tablename__ = "dashboard_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    config = Column(JSONB, nullable=False)
    changed_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    dashboard = relationship("Dashboard", back_populates="versions")
