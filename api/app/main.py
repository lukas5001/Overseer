"""
Overseer API – REST API for the Web UI and external integrations.
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from api.app.core.database import AsyncSessionLocal
from api.app.routers import auth, status, tenants, hosts, services, collectors, downtimes, config, history, users, audit, notifications, templates, two_factor, saved_filters, alert_rules, sla, admin, agent, scripts, global_policies, host_types, dashboards, reports, status_pages, discovery, dependencies, logs, sso, anomaly

# ==================== ENV Validation ====================

def _validate_env():
    secret = os.getenv("SECRET_KEY", "")
    if not secret or secret.startswith("dev_") or len(secret) < 32:
        raise RuntimeError(
            "SECRET_KEY ist nicht gesetzt oder unsicher. "
            "Setze SECRET_KEY auf einen zufälligen String mit mindestens 32 Zeichen. "
            "Generiere einen Key mit: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    enc_key = os.getenv("FIELD_ENCRYPTION_KEY", "")
    if not enc_key or len(enc_key) < 32:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY ist nicht gesetzt. "
            "Setze FIELD_ENCRYPTION_KEY auf einen 32-Byte Base64-URL-sicheren String. "
            "Generiere: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )

_validate_env()


def _validate_license():
    import hashlib, hmac, json, base64, logging
    from datetime import datetime

    logger = logging.getLogger("overseer.license")
    key = os.getenv("LICENSE_KEY", "")
    if not key:
        return  # Kein Lizenz-Key = Community-Version (unlimitiert in Dev)
    try:
        raw = base64.urlsafe_b64decode(key)
        parts = raw.rsplit(b".", 1)
        if len(parts) != 2:
            raise ValueError("Ungültiges Key-Format")
        data, sig = parts
        payload = json.loads(data)
        expires = datetime.strptime(payload["expires"], "%Y-%m-%d")
        if expires < datetime.now():
            logger.warning("LICENSE_KEY ist abgelaufen (expired: %s). Grace-Period: 7 Tage.", payload["expires"])
    except Exception as e:
        logger.warning("LICENSE_KEY Validierung fehlgeschlagen: %s. API startet trotzdem.", e)


_validate_license()

# ==================== Config ====================

SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")

# ==================== App ====================

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Overseer API",
    version="0.1.0",
    description="Monitoring system API – manages tenants, hosts, services, and check status.",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept", "X-Agent-Token"],
    expose_headers=["X-Total-Count"],
)

# ==================== Routers ====================

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(status.router, prefix="/api/v1/status", tags=["status"])
app.include_router(tenants.router, prefix="/api/v1/tenants", tags=["tenants"])
app.include_router(hosts.router, prefix="/api/v1/hosts", tags=["hosts"])
app.include_router(services.router, prefix="/api/v1/services", tags=["services"])
app.include_router(collectors.router, prefix="/api/v1/collectors", tags=["collectors"])
app.include_router(downtimes.router, prefix="/api/v1/downtimes", tags=["downtimes"])
app.include_router(config.router, prefix="/api/v1/config", tags=["config"])
app.include_router(history.router, prefix="/api/v1/history", tags=["history"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(audit.router, prefix="/api/v1/audit", tags=["audit"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["notifications"])
app.include_router(templates.router, prefix="/api/v1/service-templates", tags=["service-templates"])
app.include_router(two_factor.router, prefix="/api/v1/2fa", tags=["2fa"])
app.include_router(saved_filters.router, prefix="/api/v1/saved-filters", tags=["saved-filters"])
app.include_router(alert_rules.router, prefix="/api/v1/alert-rules", tags=["alert-rules"])
app.include_router(sla.router, prefix="/api/v1/sla", tags=["sla"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(agent.router, prefix="/api/v1", tags=["agent"])
app.include_router(scripts.router, prefix="/api/v1/scripts", tags=["scripts"])
app.include_router(global_policies.router, prefix="/api/v1/global-policies", tags=["global-policies"])
app.include_router(host_types.router, prefix="/api/v1/host-types", tags=["host-types"])
app.include_router(dashboards.router, prefix="/api/v1/dashboards", tags=["dashboards"])
app.include_router(dashboards.public_router, prefix="/api/v1/public", tags=["public"])
app.include_router(reports.router, prefix="/api/v1/reports", tags=["reports"])
app.include_router(status_pages.router, prefix="/api/v1", tags=["status-pages"])
app.include_router(status_pages.public_router, prefix="/api/v1/public", tags=["public"])
app.include_router(discovery.router, prefix="/api/v1/discovery", tags=["discovery"])
app.include_router(dependencies.router, prefix="/api/v1/dependencies", tags=["dependencies"])
app.include_router(logs.router, prefix="/api/v1/logs", tags=["logs"])
app.include_router(sso.router, prefix="/api/v1/sso", tags=["sso"])
app.include_router(anomaly.router, prefix="/api/v1/anomaly", tags=["anomaly"])


@app.get("/health")
async def health():
    checks = {"api": "ok"}
    healthy = True

    # DB check
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
        healthy = False

    # Redis check
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(REDIS_URL, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"
        healthy = False

    from fastapi.responses import JSONResponse
    status_code = 200 if healthy else 503
    return JSONResponse(
        content={"status": "ok" if healthy else "error", "database": checks.get("database", "error"), "redis": checks.get("redis", "error")},
        status_code=status_code,
    )


# ==================== Background Tasks ====================

_redis_client: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(REDIS_URL)
    return _redis_client


async def _run_downtime_expiry():
    """Core logic for downtime expiry – runs under distributed lock."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        expired = await db.execute(text("""
            SELECT id, service_id, host_id
            FROM downtimes
            WHERE active = true AND end_at < :now
        """), {"now": now})
        rows = expired.fetchall()

        for row in rows:
            await db.execute(text(
                "UPDATE downtimes SET active = false WHERE id = :id"
            ), {"id": row.id})

            if row.service_id:
                await db.execute(text("""
                    UPDATE current_status SET in_downtime = false
                    WHERE service_id = :sid
                """), {"sid": row.service_id})
            elif row.host_id:
                await db.execute(text("""
                    UPDATE current_status cs
                    SET in_downtime = false
                    FROM services s
                    WHERE cs.service_id = s.id AND s.host_id = :hid
                """), {"hid": row.host_id})

        if rows:
            await db.commit()


async def downtime_expiry_watcher():
    """Every 60s: deactivate expired downtimes and clear in_downtime flags."""
    await asyncio.sleep(20)
    while True:
        try:
            async with _get_redis().lock("overseer:lock:downtime_watcher", timeout=55, blocking_timeout=1):
                try:
                    await _run_downtime_expiry()
                except Exception as e:
                    print(f"[DowntimeExpiry] Error: {e}")
        except Exception:
            pass  # Could not acquire lock – another instance is running
        await asyncio.sleep(60)


async def _run_dead_collector_check():
    """Core logic for dead collector detection – runs under distributed lock."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=3)
        dead = await db.execute(text("""
            SELECT id, tenant_id, name
            FROM collectors
            WHERE active = true
              AND last_seen_at IS NOT NULL
              AND last_seen_at < :cutoff
        """), {"cutoff": cutoff})
        dead_rows = dead.fetchall()

        total_updated = 0
        for row in dead_rows:
            # Find services about to transition
            transitioning = await db.execute(text("""
                SELECT cs.service_id, cs.tenant_id, cs.status AS prev_status
                FROM current_status cs
                JOIN services s ON cs.service_id = s.id
                JOIN hosts h ON s.host_id = h.id
                WHERE h.collector_id = :collector_id
                  AND cs.status != 'NO_DATA'
            """), {"collector_id": row.id})
            to_transition = transitioning.fetchall()

            if not to_transition:
                continue

            await db.execute(text("""
                UPDATE current_status cs
                SET status = 'NO_DATA',
                    state_type = 'HARD',
                    status_message = 'Collector offline',
                    last_check_at = :now,
                    last_state_change_at = :now
                FROM services s
                JOIN hosts h ON s.host_id = h.id
                WHERE cs.service_id = s.id
                  AND h.collector_id = :collector_id
                  AND cs.status != 'NO_DATA'
            """), {"collector_id": row.id, "now": now})

            for svc in to_transition:
                await db.execute(text("""
                    INSERT INTO state_history
                        (id, service_id, tenant_id, previous_status, new_status, state_type, message, created_at)
                    VALUES (gen_random_uuid(), :sid, :tid, :prev, 'NO_DATA', 'HARD', 'Collector offline', :now)
                """), {"sid": svc.service_id, "tid": svc.tenant_id, "prev": svc.prev_status, "now": now})

            total_updated += len(to_transition)

        if dead_rows:
            await db.commit()
            for row in dead_rows:
                print(f"[DeadCollector] {row.name} ({row.id}) – services set to NO_DATA")


async def dead_collector_watcher():
    """Every 60s: find collectors silent for >2×interval, set their services to UNKNOWN."""
    await asyncio.sleep(15)
    while True:
        try:
            async with _get_redis().lock("overseer:lock:dead_collector_watcher", timeout=55, blocking_timeout=1):
                try:
                    await _run_dead_collector_check()
                except Exception as e:
                    print(f"[DeadCollector] Error: {e}")
        except Exception:
            pass  # Could not acquire lock – another instance is running
        await asyncio.sleep(60)


async def _run_dead_agent_check():
    """Core logic for dead agent detection – runs under distributed lock."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=3)
        # Find hosts whose agent token hasn't reported in >3 minutes
        dead = await db.execute(text("""
            SELECT DISTINCT at.host_id
            FROM agent_tokens at
            JOIN hosts h ON h.id = at.host_id
            WHERE at.active = true
              AND h.active = true
              AND h.agent_managed = true
              AND at.last_seen_at IS NOT NULL
              AND at.last_seen_at < :cutoff
        """), {"cutoff": cutoff})
        dead_hosts = dead.fetchall()

        updated = 0
        for row in dead_hosts:
            # Find services about to transition (need previous status for history)
            transitioning = await db.execute(text("""
                SELECT cs.service_id, cs.tenant_id, cs.status AS prev_status
                FROM current_status cs
                JOIN services s ON cs.service_id = s.id
                WHERE s.host_id = :host_id
                  AND s.check_mode = 'agent'
                  AND cs.status != 'NO_DATA'
            """), {"host_id": row.host_id})
            to_transition = transitioning.fetchall()

            if not to_transition:
                continue

            # Update current_status
            await db.execute(text("""
                UPDATE current_status cs
                SET status = 'NO_DATA',
                    state_type = 'HARD',
                    status_message = 'Agent offline',
                    last_check_at = :now,
                    last_state_change_at = :now
                FROM services s
                WHERE cs.service_id = s.id
                  AND s.host_id = :host_id
                  AND s.check_mode = 'agent'
                  AND cs.status != 'NO_DATA'
            """), {"host_id": row.host_id, "now": now})

            # Record state transitions in history
            for svc in to_transition:
                await db.execute(text("""
                    INSERT INTO state_history
                        (id, service_id, tenant_id, previous_status, new_status, state_type, message, created_at)
                    VALUES (gen_random_uuid(), :sid, :tid, :prev, 'NO_DATA', 'HARD', 'Agent offline', :now)
                """), {"sid": svc.service_id, "tid": svc.tenant_id, "prev": svc.prev_status, "now": now})

            updated += len(to_transition)

        if updated > 0:
            await db.commit()
            print(f"[DeadAgent] {len(dead_hosts)} offline agent(s), {updated} service(s) set to NO_DATA")


async def dead_agent_watcher():
    """Every 60s: find agents silent for >3min, set their services to UNKNOWN."""
    await asyncio.sleep(20)
    while True:
        try:
            async with _get_redis().lock("overseer:lock:dead_agent_watcher", timeout=55, blocking_timeout=1):
                try:
                    await _run_dead_agent_check()
                except Exception as e:
                    print(f"[DeadAgent] Error: {e}")
        except Exception:
            pass  # Could not acquire lock – another instance is running
        await asyncio.sleep(60)


async def refresh_aggregate_views():
    """Periodically refresh metrics materialized views.

    metrics_5m:     every 5 minutes
    metrics_hourly: every hour (on the hour cycle)
    metrics_daily:  every hour (on the hour cycle)
    """
    from api.app.core.database import engine as async_engine
    from sqlalchemy import text as sa_text

    await asyncio.sleep(30)  # Initial delay — let the app fully start
    cycle = 0
    while True:
        try:
            # Always refresh 5-min aggregate
            async with async_engine.begin() as conn:
                await conn.execute(sa_text("REFRESH MATERIALIZED VIEW CONCURRENTLY metrics_5m"))

            # Every 12th cycle (= every hour at 5-min intervals), also refresh hourly + daily
            if cycle % 12 == 0:
                async with async_engine.begin() as conn:
                    await conn.execute(sa_text("REFRESH MATERIALIZED VIEW CONCURRENTLY metrics_hourly"))
                    await conn.execute(sa_text("REFRESH MATERIALIZED VIEW CONCURRENTLY metrics_daily"))
                print("[AggRefresh] Refreshed all aggregate views")
            else:
                print("[AggRefresh] Refreshed metrics_5m")
        except Exception as e:
            print(f"[AggRefresh] Error: {e}")
        cycle += 1
        await asyncio.sleep(300)  # 5 minutes



# ==================== Anomaly Detection Background Jobs ====================

async def _compute_baselines():
    """Compute metric baselines from metrics_hourly for all active anomaly configs."""
    async with AsyncSessionLocal() as db:
        # Get all configs in learning or active state
        configs = await db.execute(text("""
            SELECT ac.service_id, ac.min_training_days, ac.status, ac.learning_started_at
            FROM anomaly_config ac
            WHERE ac.enabled = true AND ac.status IN ('learning', 'active')
        """))
        rows = configs.fetchall()

        for row in rows:
            sid = row.service_id
            try:
                # Compute baselines from last 28 days of hourly data
                baselines = await db.execute(text("""
                    SELECT
                        EXTRACT(ISODOW FROM bucket)::int - 1 AS day_of_week,
                        EXTRACT(HOUR FROM bucket)::int AS hour_of_day,
                        AVG(avg_val) AS mean,
                        COALESCE(STDDEV(avg_val), 0) AS std_dev,
                        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_val) AS median,
                        COUNT(*)::int AS sample_count
                    FROM metrics_hourly
                    WHERE service_id = :sid
                      AND bucket >= now() - interval '28 days'
                      AND avg_val IS NOT NULL
                    GROUP BY 1, 2
                """), {"sid": sid})

                baseline_rows = baselines.fetchall()
                if not baseline_rows:
                    continue

                for b in baseline_rows:
                    await db.execute(text("""
                        INSERT INTO metric_baselines
                            (service_id, day_of_week, hour_of_day, mean, std_dev, median, sample_count, updated_at)
                        VALUES (:sid, :dow, :hod, :mean, :std, :median, :cnt, now())
                        ON CONFLICT (service_id, day_of_week, hour_of_day)
                        DO UPDATE SET mean = :mean, std_dev = :std, median = :median,
                                      sample_count = :cnt, updated_at = now()
                    """), {
                        "sid": sid, "dow": b.day_of_week, "hod": b.hour_of_day,
                        "mean": b.mean, "std": b.std_dev, "median": b.median, "cnt": b.sample_count,
                    })

                # Transition from learning → active if enough training days
                if row.status == "learning" and row.learning_started_at:
                    now = datetime.now(timezone.utc)
                    days_learning = (now - row.learning_started_at).days
                    if days_learning >= row.min_training_days and len(baseline_rows) >= 24:
                        await db.execute(text("""
                            UPDATE anomaly_config SET status = 'active', activated_at = now(), updated_at = now()
                            WHERE service_id = :sid
                        """), {"sid": sid})
                        print(f"[Anomaly] Service {sid}: learning → active ({days_learning} days, {len(baseline_rows)} buckets)")

                await db.commit()
            except Exception as e:
                print(f"[Anomaly] Baseline error for {sid}: {e}")
                await db.rollback()


async def baseline_computation_job():
    """Daily: compute baselines for anomaly detection."""
    await asyncio.sleep(60)  # Initial delay
    while True:
        try:
            async with _get_redis().lock("overseer:lock:baseline_computation", timeout=300, blocking_timeout=1):
                try:
                    await _compute_baselines()
                    print("[Anomaly] Baselines computed")
                except Exception as e:
                    print(f"[Anomaly] Baseline computation error: {e}")
        except Exception:
            pass
        await asyncio.sleep(86400)  # 24 hours


async def _run_anomaly_detection():
    """Check latest metric values against baselines, create anomaly events."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        dow = now.weekday()  # 0=Monday
        hod = now.hour

        # Get all active configs with their baselines
        configs = await db.execute(text("""
            SELECT ac.service_id, ac.tenant_id, ac.sensitivity,
                   mb.mean, mb.std_dev
            FROM anomaly_config ac
            JOIN metric_baselines mb ON mb.service_id = ac.service_id
                AND mb.day_of_week = :dow AND mb.hour_of_day = :hod
            WHERE ac.enabled = true AND ac.status = 'active'
              AND mb.std_dev > 0
        """), {"dow": dow, "hod": hod})
        rows = configs.fetchall()

        for row in rows:
            try:
                # Get latest metric value (last 10 minutes)
                latest = await db.execute(text("""
                    SELECT avg_val FROM metrics_5m
                    WHERE service_id = :sid AND bucket >= now() - interval '10 minutes'
                    ORDER BY bucket DESC LIMIT 1
                """), {"sid": row.service_id})
                val_row = latest.fetchone()
                if not val_row or val_row.avg_val is None:
                    continue

                value = val_row.avg_val
                z_score = (value - row.mean) / row.std_dev

                if abs(z_score) > row.sensitivity:
                    # Check for recent dedup (no duplicate within 60 min)
                    dedup = await db.execute(text("""
                        SELECT 1 FROM anomaly_events
                        WHERE service_id = :sid AND detected_at >= now() - interval '60 minutes'
                        LIMIT 1
                    """), {"sid": row.service_id})
                    if dedup.fetchone():
                        continue

                    await db.execute(text("""
                        INSERT INTO anomaly_events
                            (service_id, tenant_id, detected_at, value, expected_mean, expected_std, z_score)
                        VALUES (:sid, :tid, :detected_at, :val, :mean, :std, :z)
                    """), {
                        "sid": row.service_id, "tid": row.tenant_id,
                        "detected_at": now, "val": value,
                        "mean": row.mean, "std": row.std_dev, "z": z_score,
                    })
                    await db.commit()
                    print(f"[Anomaly] Detected for service {row.service_id}: value={value:.2f}, z={z_score:.2f}")
            except Exception as e:
                print(f"[Anomaly] Detection error for {row.service_id}: {e}")
                await db.rollback()


async def anomaly_detection_job():
    """Every 5 minutes: detect anomalies for active configs."""
    await asyncio.sleep(45)  # Stagger with aggregate refresh
    while True:
        try:
            async with _get_redis().lock("overseer:lock:anomaly_detection", timeout=55, blocking_timeout=1):
                try:
                    await _run_anomaly_detection()
                except Exception as e:
                    print(f"[Anomaly] Detection error: {e}")
        except Exception:
            pass
        await asyncio.sleep(300)  # 5 minutes


def _linear_regression(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Simple linear regression. Returns (slope, intercept, r_squared)."""
    n = len(xs)
    if n < 2:
        return 0.0, 0.0, 0.0
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_x2 = sum(x * x for x in xs)
    sum_y2 = sum(y * y for y in ys)

    denom = n * sum_x2 - sum_x * sum_x
    if denom == 0:
        return 0.0, sum_y / n, 0.0

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R² calculation
    ss_tot = sum_y2 - (sum_y * sum_y) / n
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return slope, intercept, max(0, r_squared)


async def _run_predictions():
    """Compute resource exhaustion predictions using linear regression on daily data."""
    async with AsyncSessionLocal() as db:
        # Find services with capacity-type checks (disk, memory percentage)
        # We look for services that have recent daily metrics
        services = await db.execute(text("""
            SELECT DISTINCT s.id AS service_id, s.tenant_id, s.check_type, s.name
            FROM services s
            JOIN metrics_daily md ON md.service_id = s.id
            WHERE s.active = true
              AND s.check_type IN ('agent_disk', 'agent_memory', 'disk', 'snmp_disk')
              AND md.bucket >= now() - interval '30 days'
        """))
        svc_rows = services.fetchall()

        for svc in svc_rows:
            try:
                # Get daily averages for last 30 days
                daily = await db.execute(text("""
                    SELECT EXTRACT(EPOCH FROM bucket) AS epoch, avg_val
                    FROM metrics_daily
                    WHERE service_id = :sid AND bucket >= now() - interval '30 days'
                      AND avg_val IS NOT NULL
                    ORDER BY bucket
                """), {"sid": svc.service_id})
                points = daily.fetchall()

                if len(points) < 5:
                    continue

                xs = [p.epoch for p in points]
                ys = [p.avg_val for p in points]

                slope, intercept, r_squared = _linear_regression(xs, ys)

                # Capacity: 100 for percentage-based metrics
                capacity = 100.0
                current_value = ys[-1]

                if slope <= 0:
                    # Not growing — no prediction needed
                    continue

                rate_per_day = slope * 86400  # slope is per-second, convert to per-day
                remaining = capacity - current_value
                if remaining <= 0:
                    days_until_full = 0.0
                else:
                    days_until_full = remaining / rate_per_day

                if days_until_full > 365:
                    continue  # Too far out to be useful

                from datetime import date as _date
                predicted_date = (datetime.now(timezone.utc) + timedelta(days=days_until_full)).date()

                await db.execute(text("""
                    INSERT INTO predictions
                        (service_id, tenant_id, current_value, capacity, rate_per_day,
                         days_until_full, predicted_date, confidence)
                    VALUES (:sid, :tid, :val, :cap, :rate, :days, :pred_date, :conf)
                """), {
                    "sid": svc.service_id, "tid": svc.tenant_id,
                    "val": current_value, "cap": capacity, "rate": rate_per_day,
                    "days": days_until_full, "pred_date": predicted_date, "conf": r_squared,
                })

                await db.commit()
                if days_until_full < 30 and r_squared > 0.7:
                    print(f"[Prediction] {svc.name}: full in {days_until_full:.0f} days (confidence: {r_squared:.0%})")

            except Exception as e:
                print(f"[Prediction] Error for {svc.service_id}: {e}")
                await db.rollback()

        # Clean old predictions (keep last 7 days)
        try:
            await db.execute(text("DELETE FROM predictions WHERE created_at < now() - interval '7 days'"))
            await db.commit()
        except Exception:
            await db.rollback()


async def prediction_job():
    """Daily: compute resource exhaustion predictions."""
    await asyncio.sleep(120)  # Initial delay
    while True:
        try:
            async with _get_redis().lock("overseer:lock:prediction_job", timeout=300, blocking_timeout=1):
                try:
                    await _run_predictions()
                    print("[Prediction] Predictions computed")
                except Exception as e:
                    print(f"[Prediction] Error: {e}")
        except Exception:
            pass
        await asyncio.sleep(86400)  # 24 hours


@app.on_event("startup")
async def startup():
    asyncio.create_task(dead_collector_watcher())
    asyncio.create_task(downtime_expiry_watcher())
    asyncio.create_task(dead_agent_watcher())
    asyncio.create_task(refresh_aggregate_views())

    # Report scheduler
    from reports.scheduler import start_scheduler, cleanup_old_pdfs
    await start_scheduler()
    asyncio.create_task(cleanup_old_pdfs())

    # Status page background workers
    from statuspage.worker import status_page_worker, daily_uptime_worker
    asyncio.create_task(status_page_worker())
    asyncio.create_task(daily_uptime_worker())

    # Anomaly detection & predictions
    asyncio.create_task(baseline_computation_job())
    asyncio.create_task(anomaly_detection_job())
    asyncio.create_task(prediction_job())
