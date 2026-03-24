"""SQLAlchemy ORM models – mirrors migrations/001_initial.sql."""
from __future__ import annotations

import uuid
from datetime import datetime
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
    "OK", "WARNING", "CRITICAL", "UNKNOWN",
    name="check_status", create_type=False,
)
StateTypeEnum = SAEnum("SOFT", "HARD", name="state_type", create_type=False)
UserRoleEnum = SAEnum(
    "super_admin", "tenant_admin", "tenant_operator", "tenant_viewer",
    name="user_role", create_type=False,
)
HostTypeEnum = SAEnum(
    "server", "switch", "router", "printer", "firewall", "access_point", "other",
    name="host_type", create_type=False,
)


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False, unique=True)
    active = Column(Boolean, nullable=False, default=True)
    settings = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    collectors = relationship("Collector", back_populates="tenant")
    hosts = relationship("Host", back_populates="tenant")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    key_hash = Column(String(255), nullable=False)
    key_prefix = Column(String(12), nullable=False)
    name = Column(String(255), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    last_used_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

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
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

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
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="collectors")
    hosts = relationship("Host", back_populates="collector")


class Host(Base):
    __tablename__ = "hosts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    collector_id = Column(UUID(as_uuid=True), ForeignKey("collectors.id", ondelete="SET NULL"), nullable=True)
    hostname = Column(String(255), nullable=False)
    display_name = Column(String(255))
    ip_address = Column(INET)
    host_type = Column(HostTypeEnum, nullable=False, default="server")
    snmp_community = Column(String(255))
    snmp_version = Column(String(10), default="2c")
    winrm_username = Column(String(255))
    winrm_password = Column(String(255))
    winrm_transport = Column(String(20), default="ntlm")
    winrm_port = Column(Integer, default=5986)
    winrm_ssl = Column(Boolean, default=True)
    tags = Column(JSONB, nullable=False, default=list)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "hostname"),)

    tenant = relationship("Tenant", back_populates="hosts")
    collector = relationship("Collector", back_populates="hosts")
    services = relationship("Service", back_populates="host")


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
    check_mode = Column(String(10), nullable=False, default="passive")  # 'passive' or 'active'
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("host_id", "name"),)

    host = relationship("Host", back_populates="services")
    current_status = relationship("CurrentStatus", back_populates="service", uselist=False)


class CurrentStatus(Base):
    __tablename__ = "current_status"

    service_id = Column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    host_id = Column(UUID(as_uuid=True), ForeignKey("hosts.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    status = Column(CheckStatusEnum, nullable=False, default="UNKNOWN")
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
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


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
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


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
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
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
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    channel_type = Column(String(50), nullable=False, default="webhook")
    config = Column(JSONB, nullable=False, default=dict)
    events = Column(ARRAY(String), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class SavedFilter(Base):
    __tablename__ = "saved_filters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    filter_config = Column(JSONB, nullable=False, default=dict)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    conditions = Column(JSONB, nullable=False, default=dict)
    notification_channels = Column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class ActiveAlert(Base):
    __tablename__ = "active_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id = Column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    fired_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    last_notified_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    escalation_step = Column(Integer, nullable=False, default=0)


class EscalationPolicy(Base):
    __tablename__ = "escalation_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, unique=True)
    steps = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
