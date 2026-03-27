"""Report data collector — queries aggregate views for report data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class ServiceSLA:
    service_id: str
    service_name: str
    host_name: str
    check_type: str
    sla_pct: float
    ok_checks: int
    total_checks: int
    uptime_minutes: float
    downtime_minutes: float
    sla_target: float | None = None


@dataclass
class PerformanceMetric:
    service_id: str
    service_name: str
    host_name: str
    check_type: str
    unit: str
    avg_val: float
    max_val: float
    min_val: float
    samples: int


@dataclass
class Incident:
    service_name: str
    host_name: str
    started_at: datetime
    ended_at: datetime | None
    duration_minutes: float
    severity: str  # WARNING, CRITICAL


@dataclass
class Highlight:
    type: str  # positive / concern
    title: str
    detail: str


@dataclass
class ReportData:
    tenant_id: str
    tenant_name: str
    period_start: date
    period_end: date
    health_score: float | None
    health_score_prev: float | None
    health_color: str  # green, yellow, red
    services_sla: list[ServiceSLA] = field(default_factory=list)
    performance: list[PerformanceMetric] = field(default_factory=list)
    incidents: list[Incident] = field(default_factory=list)
    positives: list[Highlight] = field(default_factory=list)
    concerns: list[Highlight] = field(default_factory=list)
    total_services: int = 0
    total_hosts: int = 0
    services_meeting_sla: int = 0


def _health_color(score: float | None) -> str:
    if score is None:
        return "gray"
    if score >= 99:
        return "green"
    if score >= 95:
        return "yellow"
    return "red"


async def collect_report_data(
    db: AsyncSession,
    tenant_id: UUID,
    period_start: date,
    period_end: date,
    scope_host_ids: list[UUID] | None = None,
    scope_tags: list[str] | None = None,
) -> ReportData:
    """Collect all data needed for a report."""

    # Tenant name
    row = (await db.execute(
        text("SELECT name FROM tenants WHERE id = :tid"),
        {"tid": tenant_id},
    )).fetchone()
    tenant_name = row.name if row else "Unknown"

    # Time boundaries
    ts_start = datetime(period_start.year, period_start.month, period_start.day, tzinfo=timezone.utc)
    ts_end = datetime(period_end.year, period_end.month, period_end.day, 23, 59, 59, tzinfo=timezone.utc)

    # Previous period (same length) for comparison
    period_days = (period_end - period_start).days or 1
    prev_start = period_start - timedelta(days=period_days)
    prev_end = period_start - timedelta(days=1)
    ts_prev_start = datetime(prev_start.year, prev_start.month, prev_start.day, tzinfo=timezone.utc)
    ts_prev_end = datetime(prev_end.year, prev_end.month, prev_end.day, 23, 59, 59, tzinfo=timezone.utc)

    # Get services in scope
    svc_sql = """
        SELECT s.id, s.name AS service_name, s.check_type, s.sla_target,
               h.hostname, h.display_name
        FROM services s
        JOIN hosts h ON s.host_id = h.id
        WHERE s.tenant_id = :tid AND s.active = TRUE
    """
    params: dict = {"tid": tenant_id}
    if scope_host_ids:
        svc_sql += " AND s.host_id = ANY(:host_ids)"
        params["host_ids"] = scope_host_ids
    svc_rows = (await db.execute(text(svc_sql), params)).fetchall()

    if not svc_rows:
        return ReportData(
            tenant_id=str(tenant_id),
            tenant_name=tenant_name,
            period_start=period_start,
            period_end=period_end,
            health_score=None,
            health_score_prev=None,
            health_color="gray",
        )

    service_ids = [r.id for r in svc_rows]
    svc_map = {
        r.id: {
            "name": r.service_name,
            "host": r.display_name or r.hostname,
            "check_type": r.check_type,
            "sla_target": r.sla_target,
        }
        for r in svc_rows
    }

    # Count unique hosts
    host_set = {r.hostname for r in svc_rows}

    # ── SLA Calculation ──────────────────────────────────────────────────
    sla_list: list[ServiceSLA] = []
    for sid in service_ids:
        sla = await _calc_sla(db, sid, tenant_id, ts_start, ts_end)
        meta = svc_map[sid]
        sla_list.append(ServiceSLA(
            service_id=str(sid),
            service_name=meta["name"],
            host_name=meta["host"],
            check_type=meta["check_type"],
            sla_pct=sla["sla_pct"],
            ok_checks=sla["ok_checks"],
            total_checks=sla["total_checks"],
            uptime_minutes=sla["uptime_minutes"],
            downtime_minutes=sla["downtime_minutes"],
            sla_target=meta["sla_target"],
        ))

    # ── Health Score ─────────────────────────────────────────────────────
    health_score = _compute_health_score(sla_list)
    # Previous period health score
    prev_sla = []
    for sid in service_ids:
        s = await _calc_sla(db, sid, tenant_id, ts_prev_start, ts_prev_end)
        meta = svc_map[sid]
        prev_sla.append(ServiceSLA(
            service_id=str(sid), service_name=meta["name"], host_name=meta["host"],
            check_type=meta["check_type"], sla_pct=s["sla_pct"], ok_checks=s["ok_checks"],
            total_checks=s["total_checks"], uptime_minutes=s["uptime_minutes"],
            downtime_minutes=s["downtime_minutes"], sla_target=meta["sla_target"],
        ))
    health_score_prev = _compute_health_score(prev_sla)

    # ── Performance Metrics (from aggregates) ────────────────────────────
    perf_list = await _collect_performance(db, service_ids, ts_start, ts_end, svc_map)

    # ── Incidents (state transitions) ────────────────────────────────────
    incidents = await _collect_incidents(db, service_ids, ts_start, ts_end, svc_map)

    # ── Highlights & Concerns ────────────────────────────────────────────
    services_meeting_sla = sum(
        1 for s in sla_list
        if s.sla_target is not None and s.sla_pct >= s.sla_target
    )
    positives, concerns = _generate_highlights(sla_list, prev_sla, perf_list, incidents)

    return ReportData(
        tenant_id=str(tenant_id),
        tenant_name=tenant_name,
        period_start=period_start,
        period_end=period_end,
        health_score=health_score,
        health_score_prev=health_score_prev,
        health_color=_health_color(health_score),
        services_sla=sla_list,
        performance=perf_list,
        incidents=incidents,
        positives=positives,
        concerns=concerns,
        total_services=len(service_ids),
        total_hosts=len(host_set),
        services_meeting_sla=services_meeting_sla,
    )


async def _calc_sla(
    db: AsyncSession, service_id: UUID, tenant_id: UUID,
    ts_start: datetime, ts_end: datetime,
) -> dict:
    """Calculate SLA for a single service, excluding downtimes."""
    row = (await db.execute(text("""
        WITH downtime_excluded AS (
            SELECT cr.time
            FROM check_results cr
            WHERE cr.service_id = :sid AND cr.tenant_id = :tid
              AND cr.time BETWEEN :ts AND :te
              AND NOT EXISTS (
                  SELECT 1 FROM downtimes d
                  WHERE (d.service_id = cr.service_id
                         OR d.host_id = (SELECT host_id FROM services WHERE id = cr.service_id))
                    AND cr.time BETWEEN d.start_at AND d.end_at
                    AND d.active = TRUE
              )
        )
        SELECT
            COUNT(*) FILTER (WHERE cr.status = 'OK')::FLOAT / NULLIF(COUNT(*), 0) * 100 AS sla_pct,
            COUNT(*) AS total_checks,
            COUNT(*) FILTER (WHERE cr.status = 'OK') AS ok_checks
        FROM check_results cr
        WHERE cr.service_id = :sid AND cr.tenant_id = :tid
          AND cr.time BETWEEN :ts AND :te
          AND cr.time IN (SELECT time FROM downtime_excluded)
    """), {"sid": service_id, "tid": tenant_id, "ts": ts_start, "te": ts_end})).fetchone()

    total = row.total_checks or 0
    ok = row.ok_checks or 0
    sla_pct = round(row.sla_pct, 4) if row.sla_pct is not None else (100.0 if total == 0 else 0.0)
    dur = (ts_end - ts_start).total_seconds()
    up_s = (ok / total * dur) if total > 0 else dur
    return {
        "sla_pct": sla_pct,
        "total_checks": total,
        "ok_checks": ok,
        "uptime_minutes": round(up_s / 60, 1),
        "downtime_minutes": round((dur - up_s) / 60, 1),
    }


def _compute_health_score(sla_list: list[ServiceSLA]) -> float | None:
    """Weighted average of service availability. SLA-target services weighted by target."""
    if not sla_list:
        return None
    total_weight = 0.0
    weighted_sum = 0.0
    for s in sla_list:
        if s.total_checks == 0:
            continue
        w = s.sla_target if s.sla_target else 1.0
        weighted_sum += s.sla_pct * w
        total_weight += w
    if total_weight == 0:
        return None
    return round(weighted_sum / total_weight, 2)


async def _collect_performance(
    db: AsyncSession,
    service_ids: list[UUID],
    ts_start: datetime,
    ts_end: datetime,
    svc_map: dict,
) -> list[PerformanceMetric]:
    """Collect avg/max/min from aggregate views."""
    # Pick appropriate aggregate based on span
    span_days = (ts_end - ts_start).total_seconds() / 86400
    if span_days > 30:
        table = "metrics_daily"
    elif span_days > 3:
        table = "metrics_hourly"
    else:
        table = "metrics_5m"

    rows = (await db.execute(text(f"""
        SELECT service_id,
               AVG(avg_val) AS avg_val,
               MAX(max_val) AS max_val,
               MIN(min_val) AS min_val,
               SUM(samples)::INT AS samples
        FROM {table}
        WHERE service_id = ANY(:sids) AND bucket >= :ts AND bucket <= :te
        GROUP BY service_id
    """), {"sids": service_ids, "ts": ts_start, "te": ts_end})).fetchall()

    # Get units from most recent check_result
    unit_rows = (await db.execute(text("""
        SELECT DISTINCT ON (service_id) service_id, unit
        FROM check_results
        WHERE service_id = ANY(:sids) AND value IS NOT NULL
        ORDER BY service_id, time DESC
    """), {"sids": service_ids})).fetchall()
    unit_map = {r.service_id: r.unit or "" for r in unit_rows}

    result = []
    for r in rows:
        meta = svc_map.get(r.service_id, {})
        result.append(PerformanceMetric(
            service_id=str(r.service_id),
            service_name=meta.get("name", "Unknown"),
            host_name=meta.get("host", "Unknown"),
            check_type=meta.get("check_type", ""),
            unit=unit_map.get(r.service_id, ""),
            avg_val=round(r.avg_val, 2) if r.avg_val is not None else 0,
            max_val=round(r.max_val, 2) if r.max_val is not None else 0,
            min_val=round(r.min_val, 2) if r.min_val is not None else 0,
            samples=r.samples or 0,
        ))
    return result


async def _collect_incidents(
    db: AsyncSession,
    service_ids: list[UUID],
    ts_start: datetime,
    ts_end: datetime,
    svc_map: dict,
) -> list[Incident]:
    """Collect state transitions to WARNING/CRITICAL and back."""
    rows = (await db.execute(text("""
        SELECT sh.service_id, sh.new_status, sh.changed_at,
               LEAD(sh.changed_at) OVER (PARTITION BY sh.service_id ORDER BY sh.changed_at) AS next_change
        FROM state_history sh
        WHERE sh.service_id = ANY(:sids)
          AND sh.changed_at BETWEEN :ts AND :te
          AND sh.new_status IN ('WARNING', 'CRITICAL')
        ORDER BY sh.changed_at
    """), {"sids": service_ids, "ts": ts_start, "te": ts_end})).fetchall()

    incidents = []
    for r in rows:
        meta = svc_map.get(r.service_id, {})
        ended = r.next_change
        duration = ((ended or ts_end) - r.changed_at).total_seconds() / 60
        incidents.append(Incident(
            service_name=meta.get("name", "Unknown"),
            host_name=meta.get("host", "Unknown"),
            started_at=r.changed_at,
            ended_at=ended,
            duration_minutes=round(duration, 1),
            severity=r.new_status,
        ))
    return incidents


def _generate_highlights(
    sla_list: list[ServiceSLA],
    prev_sla: list[ServiceSLA],
    perf_list: list[PerformanceMetric],
    incidents: list[Incident],
) -> tuple[list[Highlight], list[Highlight]]:
    """Generate top 3 positives and top 3 concerns."""
    prev_map = {s.service_id: s.sla_pct for s in prev_sla}
    positives: list[Highlight] = []
    concerns: list[Highlight] = []

    # ── Positives ────────────────────────────────────────────────────────
    # 1. Services with 100% uptime
    perfect = [s for s in sla_list if s.sla_pct >= 100.0 and s.total_checks > 0]
    if perfect:
        names = ", ".join(s.service_name for s in perfect[:5])
        extra = f" (+{len(perfect) - 5} weitere)" if len(perfect) > 5 else ""
        positives.append(Highlight(
            type="positive",
            title=f"{len(perfect)} Services mit 100% Uptime",
            detail=f"{names}{extra}",
        ))

    # 2. Services improved vs previous period
    improved = [
        s for s in sla_list
        if s.service_id in prev_map and s.sla_pct > prev_map[s.service_id] and s.total_checks > 0
    ]
    if improved and len(positives) < 3:
        best = sorted(improved, key=lambda s: s.sla_pct - prev_map[s.service_id], reverse=True)[:3]
        for s in best:
            diff = s.sla_pct - prev_map[s.service_id]
            positives.append(Highlight(
                type="positive",
                title=f"{s.service_name} verbessert",
                detail=f"+{diff:.2f}% gegenüber Vorperiode",
            ))
            if len(positives) >= 3:
                break

    # 3. Zero incidents for SLA services
    sla_services = {s.service_name for s in sla_list if s.sla_target is not None}
    incident_services = {i.service_name for i in incidents}
    zero_incident = sla_services - incident_services
    if zero_incident and len(positives) < 3:
        positives.append(Highlight(
            type="positive",
            title=f"{len(zero_incident)} SLA-Services ohne Incidents",
            detail=", ".join(list(zero_incident)[:5]),
        ))

    # ── Concerns ─────────────────────────────────────────────────────────
    # 1. Services missing SLA target
    missed_sla = [s for s in sla_list if s.sla_target and s.sla_pct < s.sla_target]
    for s in sorted(missed_sla, key=lambda x: x.sla_pct):
        concerns.append(Highlight(
            type="concern",
            title=f"{s.service_name} unter SLA-Ziel",
            detail=f"{s.sla_pct:.2f}% (Ziel: {s.sla_target}%)",
        ))
        if len(concerns) >= 3:
            break

    # 2. High resource utilization (>80% avg)
    if len(concerns) < 3:
        high_util = [
            p for p in perf_list
            if p.avg_val > 80 and p.check_type in ("agent_cpu", "agent_memory", "agent_disk")
        ]
        for p in sorted(high_util, key=lambda x: x.avg_val, reverse=True):
            concerns.append(Highlight(
                type="concern",
                title=f"{p.host_name}: hohe {p.check_type.replace('agent_', '')} Auslastung",
                detail=f"Durchschnitt {p.avg_val:.1f}% (Max: {p.max_val:.1f}%)",
            ))
            if len(concerns) >= 3:
                break

    # 3. Recurring issues (same service >3 incidents)
    if len(concerns) < 3:
        from collections import Counter
        inc_counts = Counter(i.service_name for i in incidents)
        for svc_name, count in inc_counts.most_common():
            if count >= 3 and len(concerns) < 3:
                concerns.append(Highlight(
                    type="concern",
                    title=f"{svc_name}: {count} Incidents",
                    detail="Wiederkehrendes Problem im Berichtszeitraum",
                ))

    return positives[:3], concerns[:3]
