"""SQLAlchemy ORM models – mirrors migrations/001_initial.sql."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer,
    String, Text, UniqueConstraint, Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
from sqlalchemy.orm import relationship

from api.app.core.database import Base

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
    active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


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
    collector_id = Column(UUID(as_uuid=True), ForeignKey("collectors.id", ondelete="CASCADE"), nullable=False)
    hostname = Column(String(255), nullable=False)
    display_name = Column(String(255))
    ip_address = Column(INET)
    host_type = Column(HostTypeEnum, nullable=False, default="server")
    snmp_community = Column(String(255))
    snmp_version = Column(String(10), default="2c")
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
