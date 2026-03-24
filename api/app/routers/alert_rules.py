"""Overseer API – Alert Rules router (Phase 2.1)."""
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, tenant_scope, apply_tenant_filter
from api.app.core.email import send_email, render_alert_html
from api.app.models.models import AlertRule, ActiveAlert, EscalationPolicy, NotificationChannel

router = APIRouter()


class AlertConditions(BaseModel):
    statuses: list[str] = ["CRITICAL", "UNKNOWN"]
    min_duration_minutes: int = 5
    host_tags: list[str] = []
    service_names: list[str] = []


class AlertRuleCreate(BaseModel):
    tenant_id: UUID
    name: str
    conditions: AlertConditions = AlertConditions()
    notification_channels: list[UUID] = []
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    name: str | None = None
    conditions: AlertConditions | None = None
    notification_channels: list[UUID] | None = None
    enabled: bool | None = None


def _rule_out(rule: AlertRule) -> dict:
    return {
        "id": str(rule.id),
        "tenant_id": str(rule.tenant_id),
        "name": rule.name,
        "conditions": rule.conditions,
        "notification_channels": [str(c) for c in (rule.notification_channels or [])],
        "enabled": rule.enabled,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
    }


@router.get("/")
async def list_alert_rules(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    q = select(AlertRule).order_by(AlertRule.name)
    q = apply_tenant_filter(q, AlertRule.tenant_id, _scope, tenant_id)
    result = await db.execute(q)
    return [_rule_out(r) for r in result.scalars().all()]


@router.post("/", status_code=201)
async def create_alert_rule(
    body: AlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    if _scope is not None and body.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied to this tenant")
    rule = AlertRule(
        tenant_id=body.tenant_id,
        name=body.name,
        conditions=body.conditions.model_dump(),
        notification_channels=body.notification_channels,
        enabled=body.enabled,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _rule_out(rule)


@router.get("/{rule_id}")
async def get_alert_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    return _rule_out(rule)


@router.patch("/{rule_id}")
async def update_alert_rule(
    rule_id: UUID,
    body: AlertRuleUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    if body.name is not None:
        rule.name = body.name
    if body.conditions is not None:
        rule.conditions = body.conditions.model_dump()
    if body.notification_channels is not None:
        rule.notification_channels = body.notification_channels
    if body.enabled is not None:
        rule.enabled = body.enabled
    rule.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rule)
    return _rule_out(rule)


@router.delete("/{rule_id}", status_code=204)
async def delete_alert_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    await db.delete(rule)
    await db.commit()


@router.post("/{rule_id}/test", status_code=200)
async def test_alert_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Fire a test notification for the rule, ignoring min_duration."""
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")

    # Build a mock alert context
    ctx: dict[str, Any] = {
        "service_name": "test-service",
        "host_name": "test-host",
        "status": "CRITICAL",
        "duration_minutes": 0,
        "message": "This is a test notification from Overseer.",
        "tenant_name": str(rule.tenant_id),
        "alert_rule_name": rule.name,
        "fired_at": datetime.now(timezone.utc).isoformat(),
        "is_test": True,
    }

    sent = 0
    errors = []
    for channel_id in (rule.notification_channels or []):
        channel = await db.get(NotificationChannel, channel_id)
        if not channel or not channel.active:
            continue
        try:
            await _send_notification(channel, ctx)
            sent += 1
        except Exception as e:
            errors.append(str(e))

    return {"sent": sent, "errors": errors}


class EscalationStep(BaseModel):
    delay_minutes: int = 0
    channels: list[UUID] = []


class EscalationPolicyCreate(BaseModel):
    steps: list[EscalationStep] = []


@router.get("/{rule_id}/escalation")
async def get_escalation_policy(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(
        select(EscalationPolicy).where(EscalationPolicy.rule_id == rule_id)
    )
    policy = result.scalars().first()
    if not policy:
        raise HTTPException(status_code=404, detail="No escalation policy for this rule")
    return {"id": str(policy.id), "rule_id": str(policy.rule_id), "steps": policy.steps}


@router.put("/{rule_id}/escalation", status_code=200)
async def upsert_escalation_policy(
    rule_id: UUID,
    body: EscalationPolicyCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(
        select(EscalationPolicy).where(EscalationPolicy.rule_id == rule_id)
    )
    policy = result.scalars().first()
    steps_data = [{"delay_minutes": s.delay_minutes, "channels": [str(c) for c in s.channels]} for s in body.steps]
    if policy:
        policy.steps = steps_data
    else:
        policy = EscalationPolicy(rule_id=rule_id, steps=steps_data)
        db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return {"id": str(policy.id), "rule_id": str(policy.rule_id), "steps": policy.steps}


@router.delete("/{rule_id}/escalation", status_code=204)
async def delete_escalation_policy(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    rule = await db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    if _scope is not None and rule.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(
        select(EscalationPolicy).where(EscalationPolicy.rule_id == rule_id)
    )
    policy = result.scalars().first()
    if policy:
        await db.delete(policy)
        await db.commit()


async def _send_notification(channel: NotificationChannel, ctx: dict) -> None:
    """Send a single notification to a channel."""
    if channel.channel_type == "email":
        email_to = channel.config.get("email") or channel.config.get("to")
        if not email_to:
            raise ValueError("Channel config missing 'email' field")
        subject = f"[Overseer] {'TEST: ' if ctx.get('is_test') else ''}Alert – {ctx['alert_rule_name']}: {ctx['service_name']} is {ctx['status']}"
        body_plain = (
            f"Alert: {ctx['alert_rule_name']}\n"
            f"Service: {ctx['service_name']} on {ctx['host_name']}\n"
            f"Status: {ctx['status']}\n"
            f"Duration: {ctx['duration_minutes']} minutes\n"
            f"Message: {ctx['message']}\n"
            f"Fired at: {ctx['fired_at']}\n"
        )
        body_html = render_alert_html(ctx)
        await send_email(email_to, subject, body_plain, body_html)
    elif channel.channel_type == "webhook":
        url = channel.config.get("url")
        if not url:
            raise ValueError("Channel config missing 'url' field")
        headers = channel.config.get("headers", {})
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=ctx, headers=headers)
            resp.raise_for_status()
