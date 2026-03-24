# Overseer — Vollständiger Implementierungsplan

**Erstellt**: 2026-03-24
**Ziel**: Vollständiger, autonom ausführbarer Arbeitsplan für Claude Code.
**Repo**: `C:\Users\lukasg\Documents\claude1\Overseer\`
**Ausführungsreihenfolge**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5. Innerhalb einer Phase in der angegebenen Reihenfolge.

---

## Vorbemerkungen für Claude Code

- Alle Python-Dateien verwenden Type Hints und Pydantic v2-Syntax.
- Alle neuen Router werden in `api/app/main.py` unter `app.include_router(...)` registriert.
- Neue Migrations bekommen die nächste freie Nummer (aktuell: 012 ist die letzte → neue starten bei 013).
- Migrations werden als reine SQL-Dateien in `migrations/` abgelegt, niemals Alembic.
- Tenant-Isolation: Jede DB-Query, die Ressourcen liest, enthält einen `tenant_id`-Filter. Dieses Muster aus bestehenden Routern kopieren.
- `apply_tenant_filter` und `tenant_scope` sind bereits in `api/app/core/auth.py` vorhanden — verwenden, nicht neu bauen.
- Frontend-Sourcen liegen in `frontend/src/`, nicht in `frontend/src/app/`.
- Die bestehenden Frontend-Seiten befinden sich direkt in `frontend/src/pages/` (keine Unterordner).
- `requirements.txt` im Root gilt für alle Python-Services (api, receiver, worker).

---

## PHASE 1: Security Fixes

> **Abhängigkeit**: Keine. Phase 1 muss vollständig abgeschlossen sein bevor Phase 2 beginnt.
> **Warum zuerst**: Sicherheitslücken in Produktionssystemen haben Priorität vor Features.

---

### ✅ 1.1 Mandatory ENV Validation beim API-Start

**Was**: Beim Start des API-Prozesses prüfen ob `SECRET_KEY` unsicher ist. Crash mit erklärendem Fehler wenn ja.
**Warum**: Aktuell startet die API mit `dev_secret_key_change_in_production` in Produktion problemlos — das ist ein kritisches Sicherheitsproblem.
**Wo**: `api/app/main.py` (ganz oben, vor der `FastAPI()`-Instanz)

**Konkrete Schritte**:

1. In `api/app/main.py` nach den Imports und vor `app = FastAPI(...)` einfügen:

```python
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
```

2. Gleiches Muster in `receiver/app/main.py` für `SECRET_KEY`.

**Akzeptanzkriterium**: `docker compose up api` ohne korrekte ENV-Variablen erzeugt sofort `RuntimeError` und bricht ab. Mit korrekten Werten startet die API normal.

---

### ✅ 1.2 2FA Hardening

**Was**:
- 8-stellige statt 6-stellige Email-2FA-Codes
- Maximale Versuche: 5 pro 15 Minuten, danach 30-Minuten-Lockout
- Codes vor DB-Speicherung SHA256-hashen
- Versuchszähler in DB tracken

**Warum**: Aktuell 6-stellige Codes im Plaintext — zu leicht brute-forcebar.
**Wo**:
- `api/app/routers/two_factor.py` — Code-Generierung und Verifikation
- `api/app/models/models.py` — neue Felder auf `User`
- `migrations/008_two_factor_auth.sql` NICHT anfassen; neue Migration `migrations/013_2fa_hardening.sql`

**Konkrete Schritte**:

1. Neue Migration `migrations/013_2fa_hardening.sql` erstellen:

```sql
-- 2FA Hardening: code hash, attempt tracking, lockout
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS two_fa_email_code_hash TEXT,
    ADD COLUMN IF NOT EXISTS two_fa_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS two_fa_lockout_until TIMESTAMPTZ;

-- Altes Plaintext-Feld leeren (Migration setzt Codes auf null)
UPDATE users SET two_fa_email_code = NULL;
```

2. In `api/app/models/models.py` auf der `User`-Klasse ergänzen:

```python
two_fa_email_code_hash = Column(Text, nullable=True)
two_fa_attempts = Column(Integer, nullable=False, default=0)
two_fa_lockout_until = Column(DateTime(timezone=True), nullable=True)
```

3. In `api/app/routers/two_factor.py`:
   - `random.randint(0, 999999)` ersetzen durch `random.randint(0, 99999999)` (8 Stellen, zero-padded auf `%08d`)
   - Vor DB-Speicherung hashen: `import hashlib; code_hash = hashlib.sha256(code.encode()).hexdigest()`
   - Nur `two_fa_email_code_hash` in DB schreiben, `two_fa_email_code = None` setzen
   - Bei Verifikation: gesendeten Code hashen und gegen `two_fa_email_code_hash` prüfen
   - Lockout-Prüfung vor jeder Verifikation: wenn `two_fa_lockout_until > utcnow()`: HTTP 429, Restzeit in Response
   - Nach fehlgeschlagenem Versuch: `two_fa_attempts += 1`; wenn `>= 5`: `two_fa_lockout_until = utcnow() + timedelta(minutes=30)`, `two_fa_attempts = 0`
   - Nach erfolgreichem Versuch: `two_fa_attempts = 0`, `two_fa_lockout_until = None`, Code-Hash nullen

**Akzeptanzkriterium**: Email-2FA sendet 8-stellige Codes. Nach 5 falschen Versuchen kommt HTTP 429 mit `retry_after_seconds`. Plaintext-Code ist nicht mehr in DB sichtbar.

---

### ✅ 1.3 Feldverschlüsselung für WinRM-Passwörter und SNMP-Strings

**Was**: `winrm_password` und `snmp_community` auf `Host`-Tabelle werden vor dem Schreiben mit AES-256-GCM verschlüsselt (Python-seitig, kein pgcrypto). Beim Lesen entschlüsseln.
**Warum**: Passwörter liegen derzeit im Klartext in der DB — bei DB-Dump sofort kompromittiert.
**Wo**:
- Neue Datei `api/app/core/encryption.py`
- `api/app/routers/hosts.py` — encrypt beim CREATE/UPDATE, decrypt beim READ
- `worker/app/scheduler.py` — decrypt beim Lesen der WinRM/SNMP-Felder
- `requirements.txt` — `cryptography>=42.0.0` hinzufügen

**Konkrete Schritte**:

1. `requirements.txt`: Zeile `cryptography>=42.0.0` hinzufügen (falls nicht bereits als Transitive Dependency vorhanden — prüfen mit `grep cryptography requirements.txt`).

2. Neue Datei `api/app/core/encryption.py`:

```python
"""AES-256-GCM field-level encryption for sensitive DB columns."""
import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def _get_key() -> bytes:
    raw = os.getenv("FIELD_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("FIELD_ENCRYPTION_KEY not set")
    # Expect base64url-encoded 32-byte key
    key_bytes = base64.urlsafe_b64decode(raw + "==")
    if len(key_bytes) < 32:
        raise ValueError("FIELD_ENCRYPTION_KEY must decode to at least 32 bytes")
    return key_bytes[:32]

def encrypt_field(plaintext: str) -> str:
    """Returns base64-encoded nonce+ciphertext string for DB storage."""
    if not plaintext:
        return plaintext
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.urlsafe_b64encode(nonce + ct).decode()

def decrypt_field(ciphertext: str) -> str:
    """Decrypts a value produced by encrypt_field(). Returns plaintext."""
    if not ciphertext:
        return ciphertext
    # Detect if value is already plaintext (legacy, unencrypted)
    try:
        raw = base64.urlsafe_b64decode(ciphertext + "==")
    except Exception:
        return ciphertext  # not base64 → treat as plaintext legacy value
    if len(raw) < 13:
        return ciphertext  # too short to be valid ciphertext
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce, ct = raw[:12], raw[12:]
    try:
        return aesgcm.decrypt(nonce, ct, None).decode()
    except Exception:
        return ciphertext  # legacy plaintext fallback
```

3. In `api/app/routers/hosts.py`:
   - Import: `from api.app.core.encryption import encrypt_field, decrypt_field`
   - Bei `CREATE` und `UPDATE`: `winrm_password = encrypt_field(body.winrm_password)` und `snmp_community = encrypt_field(body.snmp_community)` vor DB-Schreiben
   - Bei Serialisierung (Response-Dict): `winrm_password` nie ausgeben (weglassen oder als `"***"` maskieren); `snmp_community` für Super-Admins entschlüsseln, für andere maskieren

4. In `worker/app/scheduler.py` und überall wo `h.winrm_password` oder `h.snmp_community` aus DB gelesen werden: `decrypt_field(value)` aufrufen.

5. Migration `013_2fa_hardening.sql` ergänzen (oder neue `014_encrypt_migration.sql`): Keine Schema-Änderung nötig — Felder sind bereits TEXT/VARCHAR. Kommentar-Notiz in Migration genügt.

**Akzeptanzkriterium**: Neuer Host mit WinRM-Passwort anlegen → direkte DB-Abfrage (`SELECT winrm_password FROM hosts`) zeigt verschlüsselten Base64-String. Worker führt Checks weiterhin erfolgreich aus.

---

### 1.4 API Rate Limiting mit slowapi

**Was**: Globales Rate Limiting 100 req/min pro authenticated User. Auth-Endpoints (Login, 2FA-Verify) 10 req/min.
**Warum**: Aktuell kein Schutz gegen Brute-Force und API-Abuse.
**Wo**:
- `requirements.txt` — `slowapi==0.1.9` hinzufügen
- `api/app/main.py` — Limiter einbinden
- `api/app/routers/auth.py` — strenge Limits auf Login-Endpoints

**Konkrete Schritte**:

1. `requirements.txt`: `slowapi==0.1.9` hinzufügen.

2. In `api/app/main.py`:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

3. In `api/app/routers/auth.py` auf dem Login-Endpoint und 2FA-Verify-Endpoint:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

limiter = Limiter(key_func=get_remote_address)

@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, ...):
    ...
```

**Akzeptanzkriterium**: Mehr als 10 Login-Requests pro Minute von derselben IP liefern HTTP 429. Normaler API-Zugriff bis 100/min uneingeschränkt.

---

### 1.5 CORS Hardening

**Was**: `allow_methods=["*"]` und `allow_headers=["*"]` durch explizite Listen ersetzen.
**Warum**: Wildcards erlauben Methoden wie CONNECT und TRACE und beliebige Header.
**Wo**: `api/app/main.py` — `CORSMiddleware`-Konfiguration

**Konkrete Schritte**:

In `api/app/main.py` die bestehende `CORSMiddleware`-Konfiguration ersetzen:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    expose_headers=["X-Total-Count"],
)
```

**Akzeptanzkriterium**: OPTIONS-Preflight mit `Access-Control-Request-Method: CONNECT` wird abgelehnt.

---

### 1.6 Distributed Locking für Background-Tasks

**Was**: `downtime_watcher` und `dead_collector_watcher` im Worker verwenden Redis-Lock, sodass nur eine Worker-Instanz diese Tasks gleichzeitig ausführt.
**Warum**: Bei `replicas: 3` in docker-compose läuft jeder Watcher dreifach — doppelte DB-Schreiboperationen und Race Conditions.
**Wo**: `worker/app/main.py` — die Watcher-Loops

**Konkrete Schritte**:

1. In `worker/app/main.py` einen `redis.asyncio`-Client instanziieren (URL aus ENV).

2. Jede Watcher-Funktion mit Redis-Lock wrappen:

```python
import redis.asyncio as aioredis

redis_client = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

async def downtime_watcher_loop():
    while True:
        async with redis_client.lock("overseer:lock:downtime_watcher", timeout=55, blocking_timeout=1):
            try:
                await run_downtime_watcher()
            except Exception as e:
                logger.error("downtime_watcher error: %s", e)
        await asyncio.sleep(60)
```

3. Gleiches Muster für `dead_collector_watcher`.

**Akzeptanzkriterium**: Bei 3 Worker-Replicas führt nur eine Instanz die Watcher aus (erkennbar an Logs — nur eine Instanz loggt die Watcher-Ausführung).

---

### 1.7 Bulk-Acknowledge Limit

**Was**: Bulk-Acknowledge-Endpoint akzeptiert maximal 500 Items.
**Warum**: Unbegrenzte Bulk-Operationen können DB und API überlasten.
**Wo**: `api/app/routers/status.py` oder `api/app/routers/services.py` — der Bulk-ACK-Endpoint (mit `grep -r "bulk" api/` finden)

**Konkrete Schritte**:

Im Pydantic-Schema für Bulk-Acknowledge:

```python
from pydantic import BaseModel, Field
from typing import Annotated

class BulkAcknowledgeRequest(BaseModel):
    service_ids: Annotated[list[UUID], Field(max_length=500)]
    comment: str = ""
```

**Akzeptanzkriterium**: POST mit 501 IDs liefert HTTP 422 mit Validierungsfehler.

---

### 1.8 Input Validation auf Service-Feldern

**Was**: `interval_seconds` muss zwischen 30 und 86400 liegen. `check_duration_ms` muss ≤ 3.600.000 sein.
**Warum**: Keine Eingabevalidierung erlaubt absurde Werte (z.B. interval=0 → Endlosschleife im Scheduler).
**Wo**: `api/app/routers/services.py` — `ServiceCreate` und `ServiceUpdate` Pydantic-Schemas

**Konkrete Schritte**:

```python
from pydantic import BaseModel, Field

class ServiceCreate(BaseModel):
    interval_seconds: int = Field(default=60, ge=30, le=86400)
    check_duration_ms: int | None = Field(default=None, le=3_600_000)
    # ... weitere Felder
```

**Akzeptanzkriterium**: POST /api/v1/services mit `interval_seconds=10` liefert HTTP 422.

---

### 1.9 API-Key: Key-Prefix aus DB entfernen

**Was**: `key_prefix`-Feld auf `ApiKey`-Tabelle nicht mehr schreiben (für neue Keys). Lookup nur noch über SHA256-Hash.
**Warum**: Selbst ein Präfix hilft beim Auffinden des Keys — Hash reicht für sicheren Lookup.
**Wo**: `api/app/routers/tenants.py` oder dort wo API-Keys erstellt werden (mit `grep -r "api_key\|key_prefix" api/` finden)

**Konkrete Schritte**:

1. Bei Key-Erstellung: `key_prefix` nicht mehr setzen (oder auf leeren String setzen).
2. Lookup-Funktion: `SELECT * FROM api_keys WHERE key_hash = $1` (bereits nach Hash).
3. Dem User beim Erstellen den vollen Key EINMALIG zurückgeben — danach nie wieder aus DB lesbar.

**Akzeptanzkriterium**: Neuer API-Key in DB hat `key_prefix = ""`. Authentifizierung per vollem Key-String funktioniert weiterhin.

---

### 1.10 TimescaleDB Hypertable-Konfiguration

**Was**: Chunk-Interval auf 1 Tag setzen, Kompression nach 30 Tagen aktivieren, Retention-Policy 90 Tage.
**Warum**: Ohne diese Konfiguration wächst die `check_results`-Tabelle unbegrenzt; TimescaleDB wird nicht optimal genutzt.
**Wo**: Neue Migration `migrations/014_timescaledb_config.sql` (Nummer anpassen falls 013 bereits vergeben)

**Konkrete Schritte**:

```sql
-- migrations/014_timescaledb_config.sql
-- TimescaleDB Hypertable Konfiguration

-- Chunk-Interval auf 1 Tag setzen (default wäre 7 Tage)
SELECT set_chunk_time_interval('check_results', INTERVAL '1 day');

-- Kompressionseinstellungen
ALTER TABLE check_results SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'service_id',
    timescaledb.compress_orderby = 'checked_at DESC'
);

-- Automatische Kompression nach 30 Tagen
SELECT add_compression_policy('check_results', INTERVAL '30 days');

-- Automatisches Löschen nach 90 Tagen
SELECT add_retention_policy('check_results', INTERVAL '90 days');
```

**Akzeptanzkriterium**: `SELECT * FROM timescaledb_information.jobs;` zeigt Compression-Job und Retention-Job.

---

## PHASE 2: Core Backend Features

> **Abhängigkeit**: Phase 1 muss abgeschlossen sein.
> Tasks in Phase 2 können in beliebiger Reihenfolge bearbeitet werden, außer: 2.2 Eskalation setzt 2.1 Alert Engine voraus.

---

### 2.1 Alert/Notification Engine

**Was**: Automatische Benachrichtigung bei anhaltenden HARD-State-Fehlern. Deduplication, Recovery-Notifications, Email-Templates.
**Warum**: Nagios-Ablösung — das ist das meistgefragte Feature von Monitoring-Systemen.
**Wo**:
- `api/app/models/models.py` — neue Klassen `AlertRule`, `ActiveAlert`
- Neue Migration `migrations/015_alert_rules.sql`
- Neuer Router `api/app/routers/alert_rules.py`
- `api/app/main.py` — Router registrieren
- `worker/app/main.py` — `check_alert_rules()` Task
- `api/app/core/email.py` — Alert-Email-Template

**Konkrete Schritte**:

**Schritt 1**: Migration `migrations/015_alert_rules.sql`:

```sql
CREATE TABLE alert_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    conditions  JSONB NOT NULL DEFAULT '{
        "statuses": ["CRITICAL", "UNKNOWN"],
        "min_duration_minutes": 5,
        "host_tags": [],
        "service_names": []
    }',
    notification_channels UUID[] NOT NULL DEFAULT '{}',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE active_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    escalation_step INTEGER NOT NULL DEFAULT 0,
    UNIQUE(service_id, rule_id)
);

CREATE INDEX idx_active_alerts_service ON active_alerts(service_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_active_alerts_tenant ON active_alerts(tenant_id) WHERE resolved_at IS NULL;
```

**Schritt 2**: In `api/app/models/models.py` hinzufügen:

```python
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
```

**Schritt 3**: Neuer Router `api/app/routers/alert_rules.py` mit CRUD:
- `GET /` — Liste aller Rules des Tenants
- `POST /` — neue Rule erstellen (Pydantic-Schema: `AlertRuleCreate` mit `tenant_id`, `name`, `conditions`, `notification_channels`, `enabled`)
- `GET /{id}` — einzelne Rule
- `PATCH /{id}` — Rule bearbeiten
- `DELETE /{id}` — Rule löschen (Soft-Delete: `enabled=False` oder Hard-Delete)
- `POST /{id}/test` — testet die Rule sofort (ignored min_duration, feuert Test-Notification)

**Schritt 4**: Router in `api/app/main.py` registrieren:
```python
from api.app.routers import alert_rules
app.include_router(alert_rules.router, prefix="/api/v1/alert-rules", tags=["alert-rules"])
```

**Schritt 5**: Worker-Task `check_alert_rules()` in `worker/app/main.py`:

```python
async def check_alert_rules(db_session, redis_client):
    """
    Läuft alle 60 Sekunden (Redis-Lock: nur eine Worker-Instanz).
    Logik:
    1. Lade alle enabled AlertRules.
    2. Für jede Rule: Finde CurrentStatus-Einträge die:
       - status IN rule.conditions.statuses
       - state_type = 'HARD'
       - acknowledged = FALSE
       - in_downtime = FALSE
       - last_state_change_at <= NOW() - INTERVAL 'min_duration_minutes'
       - (falls host_tags nicht leer) Host hat mindestens einen der Tags
       - (falls service_names nicht leer) service.name IN service_names
    3. Für jeden Treffer: UPSERT in active_alerts (ON CONFLICT service_id, rule_id DO NOTHING für neue,
       UPDATE last_notified_at für Wiederholungen falls > 1h seit last_notified_at).
    4. Wenn neuer Alert (gerade eingefügt): Notification senden.
    5. Für active_alerts ohne resolved_at: prüfen ob Service jetzt OK ist → resolved_at setzen, Recovery-Notification senden.
    """
```

**Schritt 6**: Notification-Funktion `send_alert_notification(channel, alert_context)`:
- `channel_type = "email"`: `send_email()` aus `api/app/core/email.py` nutzen, HTML-Template inline definieren
- `channel_type = "webhook"`: `httpx.AsyncClient().post(channel.config["url"], json=alert_context)` mit Timeout 10s
- Alert-Kontext-Dict: `{service_name, host_name, status, duration_minutes, message, tenant_name, alert_rule_name, fired_at}`

**Akzeptanzkriterium**:
- Alert-Rule erstellen → Service geht in HARD CRITICAL → nach 5 Minuten wird Email gesendet.
- Service wird OK → Recovery-Email wird gesendet.
- Kein zweites Email wenn Alert noch aktiv (Deduplication).

---

### 2.2 Eskalationspolicy

**Was**: Mehrstufige Eskalation — wenn Alert nach N Minuten nicht resolved, nächste Stufe benachrichtigen.
**Abhängigkeit**: 2.1 muss fertig sein.
**Wo**:
- `api/app/models/models.py` — neue Klasse `EscalationPolicy`
- Neue Migration `migrations/016_escalation.sql`
- Worker: Eskalations-Prüfung in `check_alert_rules()`

**Konkrete Schritte**:

**Schritt 1**: Migration `migrations/016_escalation.sql`:

```sql
CREATE TABLE escalation_policies (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    steps   JSONB NOT NULL DEFAULT '[]',
    -- steps Format: [{"delay_minutes": 0, "channels": ["<uuid>"]}, {"delay_minutes": 30, "channels": ["<uuid>"]}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_escalation_per_rule ON escalation_policies(rule_id);
```

**Schritt 2**: In `api/app/models/models.py`:

```python
class EscalationPolicy(Base):
    __tablename__ = "escalation_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False, unique=True)
    steps = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
```

**Schritt 3**: In Worker `check_alert_rules()` nach dem Alert-Feuern:
- Lade `EscalationPolicy` für die `rule_id`.
- Iteriere `steps` in aufsteigender `delay_minutes`-Reihenfolge.
- Wenn `fired_at + delay_minutes <= NOW()` UND `active_alert.escalation_step < step_index`: Channels des Steps benachrichtigen, `escalation_step` auf `step_index` setzen.

**Akzeptanzkriterium**: Alert-Rule mit 2-Stufen-Eskalation (0min + 30min) sendet nach dem initialen Alert nach weiteren 30 Minuten eine zweite Notification an andere Channels.

---

### 2.3 Service History API

**Was**: Aggregierte Zeitreihen-Daten für Services aus der `check_results` Hypertable.
**Wo**:
- `api/app/routers/history.py` — neue Endpoints (Datei existiert bereits, prüfen)
- Falls `history.py` andere Felder hat: neuen Router `api/app/routers/service_history.py` erstellen

**Konkrete Schritte**:

**Endpoint 1**: `GET /api/v1/services/{id}/history`

Query-Parameter: `start` (ISO-Datetime), `end` (ISO-Datetime), `interval` (Enum: `1h`, `6h`, `1d`, default `1h`)

SQL (als `text()` Query):

```sql
SELECT
    time_bucket(:interval, checked_at) AS bucket,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS check_count,
    COUNT(*) FILTER (WHERE status = 'OK')::FLOAT / COUNT(*) * 100 AS status_ok_pct
FROM check_results
WHERE service_id = :service_id
  AND tenant_id = :tenant_id
  AND checked_at BETWEEN :start AND :end
GROUP BY bucket
ORDER BY bucket ASC
```

Response-Schema (Pydantic): `list[HistoryBucket]` mit `time`, `avg_value`, `min_value`, `max_value`, `check_count`, `status_ok_pct`.

**Endpoint 2**: `GET /api/v1/hosts/{id}/services/summary`

Gibt alle Services eines Hosts zurück mit `last_status`, `last_check_at`, `last_value`, `last_unit` aus `current_status`. Kein Timeseries-Query nötig.

**Akzeptanzkriterium**: `GET /api/v1/services/{id}/history?start=2026-03-01T00:00:00Z&end=2026-03-24T00:00:00Z&interval=1d` liefert JSON-Array mit einem Eintrag pro Tag.

---

### 2.4 SLA Calculation

**Was**: Berechnung des SLA-Prozentsatzes aus historischen Check-Daten, mit Ausschluss von Downtime-Perioden.
**Wo**:
- Neue Endpoints in `api/app/routers/history.py` oder neuer Router `api/app/routers/sla.py`
- In `api/app/main.py` registrieren

**Konkrete Schritte**:

**Endpoint 1**: `GET /api/v1/services/{id}/sla?start=ISO&end=ISO`

```sql
WITH downtime_excluded AS (
    SELECT checked_at
    FROM check_results cr
    WHERE cr.service_id = :service_id
      AND cr.tenant_id = :tenant_id
      AND cr.checked_at BETWEEN :start AND :end
      AND NOT EXISTS (
          SELECT 1 FROM downtimes d
          WHERE (d.service_id = cr.service_id OR d.host_id = (SELECT host_id FROM services WHERE id = cr.service_id))
            AND cr.checked_at BETWEEN d.start_at AND d.end_at
            AND d.active = TRUE
      )
)
SELECT
    COUNT(*) FILTER (WHERE cr.status = 'OK')::FLOAT / NULLIF(COUNT(*), 0) * 100 AS sla_pct,
    COUNT(*) AS total_checks,
    COUNT(*) FILTER (WHERE cr.status = 'OK') AS ok_checks
FROM check_results cr
WHERE cr.service_id = :service_id
  AND cr.tenant_id = :tenant_id
  AND cr.checked_at BETWEEN :start AND :end
  AND cr.checked_at IN (SELECT checked_at FROM downtime_excluded)
```

Response: `{service_id, sla_pct, total_checks, ok_checks, start, end, uptime_minutes, downtime_minutes}`

**Endpoint 2**: `GET /api/v1/tenants/{id}/sla-report?start=ISO&end=ISO`

Iteriert alle Services des Tenants, ruft die SLA-Berechnung für jeden auf, gibt eine Liste zurück.
Response: `{tenant_id, period: {start, end}, services: [{service_id, service_name, host_name, sla_pct, uptime_minutes, downtime_minutes}]}`

**Akzeptanzkriterium**: SLA-Report für Tenant mit 100% OK-History gibt `sla_pct: 100.0`. Service mit bekannter Downtime gibt korrekt bereinigten Wert.

---

### 2.5 Template Apply

**Was**: Einen Service-Template auf einen Host anwenden — erstellt alle im Template definierten Services.
**Wo**: `api/app/routers/templates.py` — neuer Endpoint `POST /{id}/apply`

**Konkrete Schritte**:

```python
class TemplateApplyRequest(BaseModel):
    host_id: UUID
    overrides: dict = {}  # Überschreibt Felder aus template.checks[*]

@router.post("/{template_id}/apply")
async def apply_template(template_id: UUID, body: TemplateApplyRequest, ...):
    # 1. Template laden, Tenant-Check
    # 2. Host laden, Tenant-Check (Host muss zum selben Tenant gehören)
    # 3. Für jeden Check in template.checks:
    #    - Merge mit body.overrides
    #    - INSERT INTO services (...) ON CONFLICT (host_id, name) DO NOTHING
    # 4. AuditLog schreiben: action="template_applied", detail={template_id, host_id, created_count}
    # 5. Return: {created: N, skipped: M}
```

**Akzeptanzkriterium**: Template mit 5 Check-Definitionen auf Host anwenden → 5 neue Services in DB. Zweiter Apply-Aufruf → 0 erstellt, 5 skipped.

---

### 2.6 Recurring Downtimes

**Was**: Downtimes können mit RRULE-String für Wiederholung konfiguriert werden. Worker generiert Instanzen für die nächsten 7 Tage.
**Wo**:
- `api/app/models/models.py` — `Downtime.recurrence` Feld ergänzen
- Neue Migration `migrations/017_recurring_downtime.sql`
- Worker: neue Task `check_recurring_downtimes()`
- `requirements.txt`: `rrule` via `python-dateutil>=2.9.0`

**Konkrete Schritte**:

**Schritt 1**: Migration `migrations/017_recurring_downtime.sql`:

```sql
ALTER TABLE downtimes
    ADD COLUMN IF NOT EXISTS recurrence TEXT,  -- RRULE string, z.B. "FREQ=WEEKLY;BYDAY=SU"
    ADD COLUMN IF NOT EXISTS parent_downtime_id UUID REFERENCES downtimes(id) ON DELETE CASCADE;
    -- parent_downtime_id: generierte Instanzen verweisen auf Template-Downtime
```

**Schritt 2**: In `api/app/models/models.py` auf `Downtime`:

```python
recurrence = Column(Text, nullable=True)
parent_downtime_id = Column(UUID(as_uuid=True), ForeignKey("downtimes.id", ondelete="CASCADE"), nullable=True)
```

**Schritt 3**: `requirements.txt`: `python-dateutil>=2.9.0` hinzufügen.

**Schritt 4**: Worker-Task `check_recurring_downtimes()`:

```python
from dateutil.rrule import rrulestr

async def check_recurring_downtimes(db):
    # 1. Lade alle Downtimes mit recurrence IS NOT NULL
    # 2. Für jede: parse RRULE, generiere Vorkommen für [NOW, NOW+7d]
    # 3. Für jedes Vorkommen: prüfe ob bereits eine Instanz mit parent_downtime_id existiert
    #    für den entsprechenden start_at-Zeitpunkt
    # 4. Falls nicht: INSERT INTO downtimes (parent_downtime_id=template.id, start_at=occurrence,
    #    end_at=occurrence+(template.end_at-template.start_at), ...)
```

**Akzeptanzkriterium**: Recurring Downtime mit `FREQ=WEEKLY;BYDAY=SU` erstellen → Worker generiert Sonntags-Instanzen für die nächsten 7 Tage.

---

### 2.7 Collector Installer Generator

**Was**: API-Endpoint generiert ein Installer-Script (Shell oder PowerShell) für einen Collector.
**Wo**:
- `api/app/routers/collectors.py` — neuer Endpoint `GET /{id}/installer`
- Neue Datei `scripts/collector_config_template.yaml`

**Konkrete Schritte**:

**Schritt 1**: `scripts/collector_config_template.yaml`:

```yaml
# Overseer Collector Konfiguration
# Automatisch generiert — nicht manuell bearbeiten
api_key: "{API_KEY}"
receiver_url: "{RECEIVER_URL}"
collector_id: "{COLLECTOR_ID}"
tenant_id: "{TENANT_ID}"
check_interval: 60
log_level: info
```

**Schritt 2**: In `api/app/routers/collectors.py`:

```python
from fastapi.responses import PlainTextResponse

@router.get("/{collector_id}/installer")
async def get_installer(
    collector_id: UUID,
    os: str = "linux",  # "linux" oder "windows"
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Collector laden, API-Key des Tenants laden (ersten aktiven)
    # os=="linux": Shell-Script generieren (Python venv, real_collector.py, systemd unit)
    # os=="windows": PowerShell-Script generieren
    # Return PlainTextResponse mit korrektem Content-Disposition Header
```

Linux-Script-Template (als f-string im Code):
- `python3 -m venv /opt/overseer-collector/venv`
- Installiert `requests`, `pysnmp` via pip
- Schreibt `config.yaml` mit ausgefüllten Werten
- Schreibt `/etc/systemd/system/overseer-collector.service`
- `systemctl enable --now overseer-collector`

Windows-Script-Template:
- PowerShell, erstellt `C:\overseer-collector\`, Python venv
- Schreibt `config.yaml`, registriert Windows Service via `sc.exe` oder NSSM

**Akzeptanzkriterium**: `GET /api/v1/collectors/{id}/installer?os=linux` liefert ein Shell-Script mit `Content-Disposition: attachment; filename="overseer-collector-install.sh"`.

---

### 2.8 Tenant Resource Quotas

**Was**: Tenants haben konfigurierbare Obergrenzen für Hosts, Services, Collectors. Wird beim Erstellen geprüft.
**Wo**:
- `api/app/routers/hosts.py`, `services.py`, `collectors.py` — Quota-Check vor CREATE
- `api/app/routers/tenants.py` — neuer Endpoint `GET /{id}/usage`

**Konkrete Schritte**:

Quota-Defaults werden in `tenant.settings` JSONB gespeichert:

```python
DEFAULT_QUOTAS = {
    "max_hosts": 100,
    "max_services": 1000,
    "max_collectors": 5,
    "retention_days": 90,
}
```

Vor CREATE in jedem Router:

```python
async def check_quota(db, tenant_id, resource_type):
    tenant = await db.get(Tenant, tenant_id)
    quotas = {**DEFAULT_QUOTAS, **(tenant.settings.get("quotas", {}))}
    count_query = select(func.count()).select_from(Host).where(Host.tenant_id == tenant_id, Host.active == True)
    current = (await db.execute(count_query)).scalar()
    if current >= quotas[f"max_{resource_type}"]:
        raise HTTPException(status_code=429, detail=f"Quota für {resource_type} erreicht ({quotas[f'max_{resource_type}']})")
```

Endpoint `GET /api/v1/tenants/{id}/usage`:

```json
{
  "tenant_id": "...",
  "hosts": {"current": 12, "max": 100},
  "services": {"current": 87, "max": 1000},
  "collectors": {"current": 2, "max": 5},
  "check_results_count": 1234567
}
```

**Akzeptanzkriterium**: Tenant mit `max_hosts: 2` ablegen → 3. Host erstellen liefert HTTP 429.

---

### 2.9 Config Export/Import

**Was**: Admin kann alle Konfiguration (ohne Secrets und ohne check_results) als JSON exportieren und importieren.
**Wo**: Neuer Router `api/app/routers/admin.py`, in `main.py` registrieren unter `/api/v1/admin`

**Konkrete Schritte**:

```python
@router.get("/export")
async def export_config(user: dict = Depends(require_role("super_admin")), db=Depends(get_db)):
    # Lädt: tenants, hosts (ohne winrm_password, snmp_community), services, collectors,
    #        service_templates, alert_rules, notification_channels (ohne Secrets in config)
    # Return: JSONResponse mit Content-Disposition: attachment; filename="overseer-export-{date}.json"

@router.post("/import")
async def import_config(data: dict, user: dict = Depends(require_role("super_admin")), db=Depends(get_db)):
    # UPSERT für alle Entitäten basierend auf ID
    # Return: {imported_tenants: N, imported_hosts: N, ...}
```

**Akzeptanzkriterium**: Export → JSON-File herunterladen → Import auf frischer DB → alle Tenants, Hosts, Services vorhanden.

---

## PHASE 3: Frontend

> **Abhängigkeit**: Phase 2.1 (Alert Rules) sollte fertig sein damit die Frontend-Seiten vollständig funktionieren.
> **Wichtig**: Vor Phase 3 die fehlenden Verzeichnisse anlegen:
> - `frontend/src/hooks/`
> - `frontend/src/types/`
> - `frontend/src/utils/`
> - `frontend/src/stores/`
> - `frontend/src/components/ui/` (für shadcn-ähnliche Komponenten)

**Setup-Schritt**: `frontend/package.json` prüfen und ggf. ergänzen:

```bash
cd frontend
npm install @tanstack/react-query react-router-dom recharts date-fns zustand @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-checkbox
```

---

### 3.1 Typen und API-Client

**Was**: Zentrale TypeScript-Typen und ein typisierter API-Client als Basis für alle Seiten.
**Wo**:
- `frontend/src/types/index.ts` — alle Typen
- `frontend/src/api/client.ts` — existiert bereits, erweitern
- `frontend/src/api/hooks.ts` — neue Datei mit React Query Hooks

**Konkrete Schritte**:

`frontend/src/types/index.ts` erstellen/ergänzen mit Typen für:
- `Tenant`, `Host`, `Service`, `Collector`
- `CurrentStatus`, `ServiceHistory`, `SlaReport`
- `AlertRule`, `NotificationChannel`, `EscalationPolicy`
- `SavedFilter`, `AuditLog`, `Downtime`
- `User`, `ApiKey`

`frontend/src/api/hooks.ts` — Custom Hooks mit React Query:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

export function useHosts(tenantId?: string) {
  return useQuery({
    queryKey: ["hosts", tenantId],
    queryFn: () => apiClient.get(`/api/v1/hosts${tenantId ? `?tenant_id=${tenantId}` : ""}`).then(r => r.data),
  });
}
// ... gleiches Muster für alle Ressourcen
```

**Akzeptanzkriterium**: `tsc --noEmit` schlägt für types/index.ts nicht fehl.

---

### 3.2 Dashboard / Fehlerübersicht (Hauptseite)

**Was**: Verbesserter Haupt-Dashboard mit Statistik-Header, Filter-Bar, Tabelle mit Bulk-Select, Live-Polling.
**Wo**: `frontend/src/pages/ErrorOverviewPage.tsx` (existiert bereits — erweitern/ersetzen)

**Konkrete Schritte**:

Komponenten-Struktur innerhalb der Seite:
1. `<StatusSummaryBar>` — 4 Kacheln (CRITICAL/WARNING/UNKNOWN/OK) mit Count und Farbe
2. `<FilterBar>` — Status-Checkboxen, Tenant-Dropdown, Tag-Filter als Multi-Select, Text-Suche, Saved-Filter-Dropdown
3. `<ErrorTable>` — Spalten: Checkbox, Host, Service, Status-Badge, Dauer (formatiert mit `date-fns/formatDistanceToNow`), Tenant, Tags, Aktionen
4. `<BulkActionBar>` — erscheint wenn ≥1 Checkbox selected: "N ausgewählt | Acknowledge | Abbrechen"

State-Verwaltung:
- Filter-State in URL-Search-Params (via React Router `useSearchParams`) für Sharability
- `useQuery` mit `refetchInterval: 15_000` (15 Sekunden Polling)

Status-Farben:
- CRITICAL: `bg-red-100 text-red-800`
- WARNING: `bg-yellow-100 text-yellow-800`
- UNKNOWN: `bg-gray-100 text-gray-700`
- OK: `bg-green-100 text-green-800`

**Akzeptanzkriterium**: Seite pollt alle 15s automatisch. Bulk-Acknowledge von 3 Services funktioniert. Filter-State bleibt bei Browser-Reload erhalten (URL-Params).

---

### 3.3 Host Management Page

**Was**: Liste aller Hosts mit Suche, Filter, "Neuer Host"-Modal.
**Wo**: `frontend/src/pages/HostsPage.tsx` (existiert — erweitern)

**Komponenten**:
- `<HostTable>` — Pagination mit 25 pro Seite
- `<NewHostModal>` — Formular mit: Name, IP, check_type (Dropdown), Tags (Tag-Input), Collector-Dropdown, Template-Dropdown, WinRM-Felder (collapsible Section mit `<details>` oder Accordion)
- `<HostStatusBadge>` — zeigt "worst service status" des Hosts (abgeleitet von current_status-Daten)

**Akzeptanzkriterium**: Neuer Host-Modal öffnet sich, alle Pflichtfelder validiert (HTML5 required), Submit erstellt Host via API und schließt Modal.

---

### 3.4 Host Detail Page

**Was**: Detailansicht eines Hosts mit Service-Liste, Mini-Graphen, History-Tab, Downtime-Tab.
**Wo**: `frontend/src/pages/HostDetailPage.tsx` (existiert — stark erweitern)

**Konkrete Schritte**:

Seiten-Layout:
1. **Header**: Hostname, IP, Tags als Badges, Status-Zusammenfassung (X CRITICAL, Y WARNING)
2. **Tab-Navigation**: "Services" | "History" | "Downtimes"
3. **Services-Tab**:
   - Tabelle: Name, Status-Badge, letzter Wert + Einheit, letzte Prüfung (relative Zeit)
   - Pro Service-Zeile: aufklappbarer Mini-Graph (`<MiniGraph>` Komponente mit Recharts `LineChart`)
   - Mini-Graph Daten: `GET /api/v1/services/{id}/history?interval=1h&start=<24h ago>`
   - Graph zeigt Value-Linie + horizontale Threshold-Linien (warn=gelb, crit=rot)
   - Aktions-Buttons: Acknowledge, Check Now, Downtime planen, Bearbeiten, Löschen
4. **History-Tab**: Timeline der letzten State-Wechsel aus `GET /api/v1/history?service_id=...`
5. **Downtime-Tab**: Aktive + vergangene Downtimes, "Neue Downtime" Button mit Modal

`<MiniGraph>` Komponente (`frontend/src/components/MiniGraph.tsx`):
```typescript
import { LineChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from "recharts";
// Props: data: HistoryBucket[], thresholdWarn: number | null, thresholdCrit: number | null
```

**Akzeptanzkriterium**: Host-Detail-Seite lädt, Services werden angezeigt. Klick auf Service-Zeile expandiert Mini-Graph mit 24h-Verlauf.

---

### 3.5 Tenants Page (Super-Admin)

**Was**: Tenant-Verwaltung mit Tabs für API-Keys, Users, Quotas, Collectors.
**Wo**: `frontend/src/pages/TenantsPage.tsx` (existiert — erweitern)
**Sichtbarkeit**: Nur wenn `user.role === "super_admin"`

**Tabs pro Tenant-Detail**:
- **API-Keys**: Liste, "Neuer Key" Button (zeigt Key einmalig), "Revoke" Button
- **Users**: zugewiesene User, "User zuweisen" (Dropdown bestehender User)
- **Quotas**: Formular für `max_hosts`, `max_services`, `max_collectors`, `retention_days`
- **Collectors**: zugeordnete Collectors mit Status

**Akzeptanzkriterium**: Super-Admin kann neuen Tenant erstellen, API-Key generieren, Key wird einmalig angezeigt.

---

### 3.6 Collectors Page

**Was**: Verwaltung der Collector-VMs mit Installer-Download.
**Wo**: Neue Datei `frontend/src/pages/CollectorsPage.tsx`
**Route**: `/collectors` in `App.tsx` registrieren

**Komponenten**:
- Tabelle: Name, Status (grün=online wenn `last_seen_at < 5min`, sonst rot=offline), letzter Heartbeat (relative Zeit), Version, Tenant
- "Download Installer" Button → Modal mit OS-Auswahl (Linux/Windows) → `GET /api/v1/collectors/{id}/installer?os=...` → Browser-Download
- "Neuer Collector" Modal: Name, Tenant-Auswahl (falls Super-Admin)

**Akzeptanzkriterium**: Installer-Download öffnet Browser-Datei-Dialog. Online/Offline-Status korrekt basierend auf `last_seen_at`.

---

### 3.7 Alert Rules Page

**Was**: Verwaltung von Alert-Regeln pro Tenant.
**Wo**: Neue Datei `frontend/src/pages/AlertRulesPage.tsx`

**Komponenten**:
- Liste der Regeln: Name, Bedingungen-Zusammenfassung, Channels-Count, enabled/disabled Toggle
- "Neue Regel" Modal:
  - Name
  - Status-Checkboxes (CRITICAL, WARNING, UNKNOWN) — Mehrfachauswahl
  - Min-Dauer Slider (0–120 Minuten)
  - Host-Tags Filter (Text-Input mit Chips)
  - Service-Namen Filter (Text-Input mit Chips)
  - Notification-Channels Auswahl (Multi-Select aus vorhandenen Channels)
- Eskalations-Steps Konfiguration (innerhalb desselben Modals):
  - "+ Schritt hinzufügen" Button
  - Pro Schritt: Verzögerung in Minuten, Channel-Auswahl
  - Schritte können per Drag-and-Drop umsortiert werden (oder Up/Down Buttons)

**Akzeptanzkriterium**: Neue Alert-Rule erstellen mit 2 Eskalations-Stufen → in DB gespeichert mit korrekten JSONB-Daten.

---

### 3.8 Notification Channels Page

**Was**: Email- und Webhook-Channels verwalten.
**Wo**: Neue Datei `frontend/src/pages/NotificationChannelsPage.tsx`

**Komponenten**:
- Liste der Channels: Name, Typ (Email/Webhook), Status (active)
- "Neuer Channel" Modal:
  - Type-Radio (Email | Webhook)
  - **Email**: Empfänger-Adresse, Betreff-Präfix
  - **Webhook**: URL, HTTP-Method (Dropdown GET/POST/PUT), Headers (Key-Value-Editor: + Zeile hinzufügen, Zeile löschen), Body-Template (Textarea)
- "Testen" Button → `POST /api/v1/notifications/{id}/test` → Erfolgs/Fehler-Toast

`POST /api/v1/notifications/{id}/test` muss im Backend implementiert werden (falls noch nicht vorhanden): sendet Test-Payload an den Channel.

**Akzeptanzkriterium**: Test-Button für Email-Channel sendet Test-Email an konfigurierte Adresse.

---

### 3.9 Settings Page

**Was**: User-Profil, Passwort, 2FA, Präferenzen.
**Wo**: Neue Datei `frontend/src/pages/SettingsPage.tsx`

**Tabs**:
1. **Profil**: Display-Name bearbeiten, Passwort ändern (aktuelles PW + neues PW + Bestätigung)
2. **2FA**:
   - Status anzeigen: "Deaktiviert" / "TOTP aktiv" / "Email-2FA aktiv"
   - TOTP aktivieren: QR-Code anzeigen (Base64-PNG aus API), Verifikations-Code eingeben
   - Email-2FA aktivieren: Button → API sendet Code → Code eingeben
   - Deaktivieren: Bestätigungs-Dialog
3. **Präferenzen**: Standard-Filter (Dropdown aus saved Filters), Polling-Interval (15s/30s/60s/manuell)

**Akzeptanzkriterium**: QR-Code für TOTP wird korrekt als `<img src="data:image/png;base64,...">` angezeigt.

---

### 3.10 Admin Page

**Was**: System-Verwaltung nur für Super-Admins.
**Wo**: Neue Datei `frontend/src/pages/AdminPage.tsx`

**Tabs**:
1. **System**: API-Health (`GET /health`), DB-Größe, Redis-Status — als Status-Cards
2. **Users**: Tabelle aller User, Inline-Edit für Rolle, Deaktivieren-Button, "Neuer User" Modal
3. **Backup**: "Export JSON" Button (Download), "Import JSON" Button (Datei-Upload)
4. **Audit-Log**: Tabelle mit Filter: User (Dropdown), Aktion (Text), Datum-Range — paginated

**Akzeptanzkriterium**: Export-Button lädt JSON-Datei herunter. Audit-Log zeigt letzte 50 Einträge.

---

### 3.11 SLA Reports Page

**Was**: SLA-Auswertungen pro Tenant und Zeitraum.
**Wo**: Neue Datei `frontend/src/pages/SlaReportsPage.tsx`

**Layout**:
- Toolbar: Tenant-Dropdown (falls Super-Admin), Zeitraum-Buttons (Letzte 7/30/90 Tage) + Custom Date-Range-Picker
- Tabelle: Service, Host, SLA%, Uptime (Minuten), Downtime (Minuten), Incidents
- Farbkodierung der SLA%-Spalte: `>= 99.9%` → grüner Text, `>= 99.5%` → gelber Text, `< 99.5%` → roter Text
- "CSV exportieren" Button → generiert CSV client-seitig aus den geladenen Daten (keine API nötig)

**Akzeptanzkriterium**: CSV-Export lädt Datei mit korrekten Spalten herunter (client-seitiges CSV-Building mit Array.join).

---

### 3.12 TV Modus

**Was**: Vollbild-Dashboard ohne Sidebar, optimiert für Monitor an der Wand. Unterstützt read-only TV-Token.
**Wo**:
- Neue Datei `frontend/src/pages/TvPage.tsx`
- Route `/tv` in `App.tsx`
- Backend: neuer Endpoint `GET /api/v1/auth/tv-token` (Super-Admin only)

**Backend-Schritte**:

In `api/app/routers/auth.py`:

```python
@router.get("/tv-token")
async def create_tv_token(filter_id: UUID | None = None, user: dict = Depends(require_role("super_admin"))):
    # JWT ohne Ablauf (oder sehr langer Ablauf: 10 Jahre), mit claim: {"tv_mode": True, "filter_id": str(filter_id)}
    # Beim Validieren: tv_mode-Token akzeptieren für read-only Endpoints
    pass
```

**Frontend-Schritte**:

`TvPage.tsx`:
- Liest URL-Params: `?token=`, `?filter_id=`, `?tenant_id=`, `?refresh=` (default 30), `?pivot=`
- Wenn `?token=`: Token in axios-Header setzen (kein Login nötig)
- Layout: Volle Viewport-Breite, große Schrift (text-xl), hoher Kontrast (dark mode oder white-on-dark)
- Wenn `?pivot=true`: CSS `transform: rotate(90deg)` auf Root-Element, Viewport-Dimensionen tauschen
- Polling: `useQuery` mit `refetchInterval: (refresh * 1000)`

**Akzeptanzkriterium**: `/tv?token=<valid_tv_token>` zeigt Fehlerübersicht ohne Login. `/tv?pivot=true` rotiert die Ansicht 90 Grad.

---

### 3.13 Service Templates Page

**Was**: Verwaltung von Service-Templates mit Apply-Funktion.
**Wo**: Neue Datei `frontend/src/pages/ServiceTemplatesPage.tsx`

**Komponenten**:
- Liste: Name, Anzahl Checks, Beschreibung
- "Neuer Template" Modal:
  - Name, Beschreibung
  - Check-Tabelle mit "+ Zeile" Button: Name, Check-Typ (Dropdown), Intervall (Sekunden), Warn-Threshold, Crit-Threshold, Check-Config (JSON-Textarea)
- "Apply on Host" Modal: Host-Dropdown (gefiltert nach Tenant) → `POST /api/v1/service-templates/{id}/apply`

**Akzeptanzkriterium**: Template mit 3 Checks erstellen → auf Host anwenden → 3 neue Services im Host-Detail sichtbar.

---

## PHASE 4: Docker + Self-Hosting

> **Abhängigkeit**: Phase 1 muss abgeschlossen sein (ENV-Variablen definiert).

---

### 4.1 docker-compose.yml vollständig konfigurieren

**Was**: Das bestehende `docker-compose.yml` erweitern um: `worker`-Replicas auf 3, `nginx` als Reverse-Proxy, fehlende ENV-Variablen.
**Wo**: `docker-compose.yml` im Root

**Konkrete Änderungen**:

1. Worker auf 3 Replicas:
```yaml
worker:
  deploy:
    replicas: 3
```

2. Neuen `nginx`-Service hinzufügen:
```yaml
nginx:
  image: nginx:alpine
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    - ./frontend/dist:/usr/share/nginx/html:ro
  depends_on:
    - api
    - receiver
```

3. ENV-Variablen ergänzen in api/receiver/worker Services:
```yaml
environment:
  FIELD_ENCRYPTION_KEY: ${FIELD_ENCRYPTION_KEY}
  SMTP_HOST: ${SMTP_HOST:-smtp.ionos.de}
  SMTP_PORT: ${SMTP_PORT:-587}
  SMTP_USER: ${SMTP_USER}
  SMTP_PASS: ${SMTP_PASS}
  SMTP_FROM: ${SMTP_FROM:-overseer@dailycrust.it}
  AI_ENABLED: ${AI_ENABLED:-false}
  LICENSE_KEY: ${LICENSE_KEY:-}
```

---

### 4.2 Nginx-Konfiguration

**Was**: Nginx als Reverse Proxy für API, Receiver und Frontend.
**Wo**: Neue Datei `deploy/nginx.conf`

```nginx
server {
    listen 80;
    server_name _;

    # Frontend (React Build)
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api/ {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Receiver (Collector-Endpunkte)
    location /receiver/ {
        proxy_pass http://receiver:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

### 4.3 setup.sh Script

**Was**: Einmalig ausgeführtes Initialisierungsscript für neue Deployments.
**Wo**: Neue Datei `setup.sh` im Root

```bash
#!/bin/bash
set -euo pipefail

echo "=== Overseer Setup ==="

# 1. Prüfe ob .env existiert
if [ ! -f .env ]; then
    cp .env.example .env
    echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" >> .env
    echo "FIELD_ENCRYPTION_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" >> .env
    echo ".env erstellt — bitte POSTGRES_PASSWORD, SMTP_* und andere Werte eintragen."
    exit 1
fi

# 2. Docker-Compose hochfahren (nur Infra)
docker compose up -d postgres redis

# 3. Auf DB warten
echo "Warte auf PostgreSQL..."
until docker compose exec postgres pg_isready -U overseer; do sleep 1; done

# 4. Migrations ausführen
python3 scripts/migrate.py

# 5. Admin-User erstellen (falls nicht vorhanden)
python3 scripts/create_admin.py

echo "=== Setup abgeschlossen ==="
```

---

### 4.4 .env.example aktualisieren

**Was**: `.env.example` mit allen neuen Variablen aus Phase 1-4 aktualisieren.
**Wo**: `.env.example` im Root (existiert noch nicht — erstellen)

```env
# Datenbank
POSTGRES_PASSWORD=change_me_in_production
DATABASE_URL=postgresql+asyncpg://overseer:change_me_in_production@postgres:5432/overseer

# Sicherheit
SECRET_KEY=generate_with_secrets_token_hex_32
FIELD_ENCRYPTION_KEY=generate_with_secrets_token_urlsafe_32

# Redis
REDIS_URL=redis://redis:6379

# SMTP (IONOS)
SMTP_HOST=smtp.ionos.de
SMTP_PORT=587
SMTP_USER=overseer@dailycrust.it
SMTP_PASS=change_me
SMTP_FROM=overseer@dailycrust.it

# CORS
CORS_ORIGINS=https://yourdomain.com

# AI (optional)
AI_ENABLED=false
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3.1:8b

# Lizenz (optional)
LICENSE_KEY=
```

---

### 4.5 GitHub Actions Workflow

**Was**: CI/CD-Pipeline: Docker-Build auf Push to main, Push zu ghcr.io.
**Wo**: Neue Datei `.github/workflows/docker-publish.yml`

```yaml
name: Docker Build & Publish

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/lukas5001/overseer

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push API
        uses: docker/build-push-action@v5
        with:
          context: .
          file: api/Dockerfile
          push: true
          tags: ${{ env.IMAGE_PREFIX }}-api:latest,${{ env.IMAGE_PREFIX }}-api:${{ github.sha }}

      # Gleiches Pattern für receiver, worker, frontend
```

---

### 4.6 License Key Validation

**Was**: HMAC-SHA256-basiertes Offline-Lizenzierungssystem.
**Wo**:
- Neue Datei `scripts/generate_license.py` (internes Tool)
- `api/app/main.py` — Validierung beim Start

**Konkrete Schritte**:

`scripts/generate_license.py`:

```python
"""Nur intern verwenden — generiert signierte Lizenz-Keys."""
import hashlib, hmac, json, base64, sys
from datetime import datetime

SECRET = "overseer_license_signing_secret_never_expose"  # Intern, nicht im Repo

def generate(customer: str, expires: str, max_hosts: int) -> str:
    payload = {"customer": customer, "expires": expires, "max_hosts": max_hosts}
    data = json.dumps(payload, sort_keys=True).encode()
    sig = hmac.new(SECRET.encode(), data, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(data + b"." + sig).decode()

if __name__ == "__main__":
    print(generate(sys.argv[1], sys.argv[2], int(sys.argv[3])))
```

In `api/app/main.py` (nach `_validate_env()`):

```python
def _validate_license():
    key = os.getenv("LICENSE_KEY", "")
    if not key:
        return  # Kein Lizenz-Key = Community-Version (unlimitiert in Dev)
    # Base64 dekodieren, HMAC prüfen, expires prüfen, max_hosts prüfen
    # Bei Fehler: Logger-Warning (kein Crash — Grade-Period von 7 Tagen)
```

**Akzeptanzkriterium**: Ungültiger LICENSE_KEY erzeugt Warning im Log. API startet trotzdem (kein harter Fehler).

---

## PHASE 5: LLM / AI Integration

> **Abhängigkeit**: Phase 2 (insbesondere 2.3 Service History) muss abgeschlossen sein.
> **Vorbedingung**: `AI_ENABLED=true` in ENV und Ollama läuft.

---

### 5.1 AI Service erstellen

**Was**: Separater FastAPI-Service auf Port 8002 für AI-Funktionen.
**Wo**: Neues Verzeichnis `ai_service/` im Root

**Verzeichnisstruktur erstellen**:

```
ai_service/
  Dockerfile
  requirements.txt  (fasapi, uvicorn, httpx, sqlalchemy, asyncpg, pgvector)
  app/
    __init__.py
    main.py
    config.py
    routers/
      __init__.py
      analysis.py
      query.py
      knowledge.py
    services/
      __init__.py
      context.py
      ollama.py
      rag.py
      prompts.py
```

`ai_service/app/main.py`:

```python
import os
from fastapi import FastAPI

AI_ENABLED = os.getenv("AI_ENABLED", "false").lower() == "true"

app = FastAPI(title="Overseer AI Service", version="0.1.0")

if AI_ENABLED:
    from ai_service.app.routers import analysis, query, knowledge
    app.include_router(analysis.router, prefix="/ai/analyze", tags=["analysis"])
    app.include_router(query.router, prefix="/ai/query", tags=["query"])
    app.include_router(knowledge.router, prefix="/ai/knowledge", tags=["knowledge"])

@app.get("/health")
async def health():
    return {"status": "ok", "ai_enabled": AI_ENABLED}
```

---

### 5.2 pgvector Extension und Knowledge-Tabelle

**Was**: PostgreSQL pgvector Extension für Embedding-Speicherung.
**Wo**: Neue Migration `migrations/018_pgvector.sql`

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_embeddings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
    content     TEXT NOT NULL,
    embedding   vector(4096),  -- Dimensionen abhängig vom Modell
    source      VARCHAR(50) NOT NULL DEFAULT 'user',  -- 'user' oder 'auto'
    confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

---

### 5.3 Ollama Client

**Was**: Async HTTP-Client für Ollama API.
**Wo**: `ai_service/app/services/ollama.py`

```python
import httpx
import os

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

async def chat_completion(messages: list[dict], temperature: float = 0.3) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={"model": OLLAMA_MODEL, "messages": messages, "stream": False, "options": {"temperature": temperature}},
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]

async def get_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/embeddings", json={"model": OLLAMA_MODEL, "prompt": text})
        resp.raise_for_status()
        return resp.json()["embedding"]
```

---

### 5.4 AI Analyse-Endpoint

**Was**: Analysiert einen fehlerhaften Service und gibt Diagnose zurück.
**Wo**: `ai_service/app/routers/analysis.py`

```python
@router.post("/{service_id}")
async def analyze_service(service_id: UUID, db=Depends(get_db)):
    # 1. context.py: Service-Info laden (name, check_type, thresholds, host)
    # 2. context.py: Letzte 100 check_results mit Werten und Status
    # 3. context.py: Letzte 20 state_history-Einträge
    # 4. rag.py: Ähnliche Einträge aus knowledge_embeddings via pgvector-Similarity
    # 5. prompts.py: System-Prompt + User-Prompt zusammenbauen
    # 6. ollama.py: chat_completion aufrufen
    # 7. Return: {diagnosis: str (Markdown), suggestions: [str], confidence: float, similar_cases: []}
```

System-Prompt-Template in `ai_service/app/services/prompts.py`:

```python
ANALYSIS_SYSTEM_PROMPT = """
Du bist ein Monitoring-Experte für IT-Infrastruktur. Analysiere den folgenden Service-Fehler
und gib eine strukturierte Diagnose auf Deutsch aus. Format:

## Diagnose
<Ursache des Problems>

## Mögliche Ursachen
- <Ursache 1>
- <Ursache 2>

## Empfohlene Maßnahmen
1. <Schritt 1>
2. <Schritt 2>

Antworte IMMER auf Deutsch. Sei präzise und technisch korrekt.
"""
```

---

### 5.5 Natural Language Query Endpoint

**Was**: User stellt Fragen in natürlicher Sprache, AI übersetzt in DB-Abfrage und gibt Antwort.
**Wo**: `ai_service/app/routers/query.py`

```python
class NLQueryRequest(BaseModel):
    question: str
    tenant_id: UUID
    context_host_id: UUID | None = None

@router.post("/")
async def natural_language_query(body: NLQueryRequest, db=Depends(get_db)):
    # 1. Prompt: "Übersetze folgende Frage in eine PostgreSQL-Abfrage auf dem Overseer-Schema.
    #    Schema: [Schema-Beschreibung]. Frage: {body.question}. Gib NUR SQL aus, keine Erklärung."
    # 2. Ollama gibt SQL zurück
    # 3. SQL mit SEHR STRENGER Validierung prüfen (nur SELECT erlaubt, kein DELETE/DROP/UPDATE)
    # 4. SQL ausführen mit tenant_id-Filter
    # 5. Ergebnis in lesbarer Antwort verpacken via zweitem Ollama-Call
    # Return: {question, answer: str, data: list[dict], sql_used: str}
```

**Sicherheitshinweis für Claude Code**: Die SQL-Validierung muss vor Ausführung sicherstellen dass:
- Die Query mit `SELECT` beginnt
- Keine destructive Keywords (`DELETE`, `DROP`, `TRUNCATE`, `UPDATE`, `INSERT`) enthalten
- `tenant_id = :tenant_id` als Parameter injiziert wird (nie per String-Concatenation)

---

### 5.6 Knowledge Base

**Was**: User-bestätigte Fehler-Ursachen und Lösungen als Vektordatenbank.
**Wo**: `ai_service/app/routers/knowledge.py`

```python
@router.post("/")
async def add_knowledge(body: KnowledgeCreate, db=Depends(get_db)):
    # 1. Embedding für body.content generieren (ollama.get_embedding)
    # 2. INSERT INTO knowledge_embeddings (content, embedding, service_id, tenant_id, confirmed=True)
    # Return: {id, content}

@router.get("/{service_id}")
async def get_relevant_knowledge(service_id: UUID, db=Depends(get_db)):
    # 1. Aktuellen Fehler des Service als Text formulieren
    # 2. Embedding berechnen
    # 3. pgvector-Similarity-Query: ORDER BY embedding <=> :query_embedding LIMIT 5
    # Return: list[{content, similarity}]
```

---

### 5.7 Frontend AI-Integration

**Was**: "KI analysieren" Button in Host-Detail-Page, Chat-Widget auf Dashboard.
**Wo**:
- `frontend/src/pages/HostDetailPage.tsx` — Button + Side-Panel
- `frontend/src/components/AiChatWidget.tsx` — neues Component
- `frontend/src/api/hooks.ts` — neue Hooks für AI-Endpoints

**AI-Analyse Side-Panel** (`AiAnalysisPanel.tsx`):

```typescript
// Props: serviceId: string, onClose: () => void
// Zustand: loading, diagnosis: string | null, error: string | null
// 1. POST /ai/analyze/{serviceId} aufrufen (Timeout-Hinweis anzeigen: "Analyse läuft...")
// 2. Ergebnis als Markdown rendern (react-markdown Bibliothek)
// 3. Daumen-hoch/runter Buttons → POST /ai/knowledge mit user-Feedback
```

**Chat-Widget** (`AiChatWidget.tsx`):

```typescript
// Floating Button rechts unten (position: fixed, bottom: 20px, right: 20px)
// Klick öffnet Chat-Panel (Slide-in von rechts)
// Messages-Liste (user + assistant), Eingabe-Feld, Senden-Button
// POST /ai/query mit question + aktuellem Kontext (tenant_id, aktive Host/Service-ID)
// Konversations-Verlauf im Component-State halten (nicht persistiert)
```

**Akzeptanzkriterium**: "KI analysieren" Button erscheint für Services mit CRITICAL/UNKNOWN Status. Klick öffnet Panel mit Lade-Animation, dann Markdown-Diagnose.

---

## Migrations-Reihenfolge (Zusammenfassung)

| Nummer | Datei | Inhalt | Phase |
|--------|-------|--------|-------|
| 013 | `013_2fa_hardening.sql` | 2FA Hash-Felder, Attempt-Tracking | 1.2 |
| 014 | `014_timescaledb_config.sql` | TimescaleDB Chunk/Compress/Retention | 1.10 |
| 015 | `015_alert_rules.sql` | alert_rules, active_alerts Tabellen | 2.1 |
| 016 | `016_escalation.sql` | escalation_policies Tabelle | 2.2 |
| 017 | `017_recurring_downtime.sql` | Downtime.recurrence, parent_downtime_id | 2.6 |
| 018 | `018_pgvector.sql` | pgvector Extension, knowledge_embeddings | 5.2 |

> **Hinweis**: Falls 013 für beide Tasks (2FA + Encryption-Migration-Kommentar) verwendet wird: die 2FA-Änderungen kommen in 013, TimescaleDB in 014. Oder in zwei separate Dateien 013 und 014 aufteilen und TimescaleDB auf 015 verschieben — entsprechend alle folgenden Nummern anpassen.

---

## requirements.txt — Alle neuen Dependencies

Zum bestehenden `requirements.txt` hinzufügen:

```
# Security
slowapi==0.1.9
cryptography>=42.0.0

# Recurring Downtimes
python-dateutil>=2.9.0

# AI Service (nur in ai_service/requirements.txt)
# pgvector>=0.3.0
# httpx>=0.27.0  (bereits vorhanden)
```

---

## Abhängigkeits-Diagramm (Aufgaben)

```
1.1 ENV Validation
    └── (alles andere in Phase 1)

1.3 Feldverschlüsselung
    └── 1.1 (FIELD_ENCRYPTION_KEY aus ENV)

2.1 Alert Engine
    └── Phase 1 komplett

2.2 Eskalation
    └── 2.1 Alert Engine

3.1 Typen + API Client
    └── (Basis für alle Frontend-Seiten)

3.2 Dashboard
    └── 3.1

3.4 Host Detail
    └── 3.1, 2.3 (Service History API für Graphs)

3.7 Alert Rules Page
    └── 2.1, 3.1

3.12 TV Modus (Backend)
    └── 1.1

5.1-5.6 AI Service
    └── Phase 2 komplett, pgvector auf DB

5.7 Frontend AI
    └── 5.1-5.6, 3.4
```

---

## Hinweise für Claude Code

1. **Nie Schema direkt ändern**: Immer neue Migrations-Datei anlegen.
2. **Tenant-Isolation**: Jeder neue Endpoint der tenant-spezifische Daten zurückgibt muss `apply_tenant_filter` verwenden — Pattern aus bestehenden Routern kopieren (z.B. `notifications.py`).
3. **Audit-Log**: Jede CREATE/UPDATE/DELETE-Operation auf wichtigen Ressourcen muss `write_audit()` aus `api/app/routers/audit.py` aufrufen.
4. **Async durchgängig**: Alle DB-Zugriffe sind `await db.execute(...)`. Nie synchrone SQLAlchemy-Sessions verwenden.
5. **Router-Registrierung**: Nach jedem neuen Router `app.include_router(...)` in `api/app/main.py` eintragen.
6. **Frontend-Routes**: Jede neue Seite als `<Route path="..." element={<NewPage />} />` in `frontend/src/App.tsx` registrieren.
7. **TypeScript strict**: Keine `any`-Typen. Alle API-Response-Typen müssen in `frontend/src/types/index.ts` definiert sein.
8. **Fehler-Handling im Frontend**: Jeder API-Call in React Query braucht `onError`-Handler der einen Toast/Alert zeigt.
9. **Worker Redis-Lock**: Jeder Worker-Task der globalen State schreibt (Downtime-Watcher, Alert-Rules-Checker, etc.) muss Redis-Lock aus 1.6 verwenden.
10. **Verschlüsselungs-Rückwärtskompatibilität**: `decrypt_field()` muss Legacy-Plaintext-Werte (die noch nicht verschlüsselt sind) transparent zurückgeben — ist in der Code-Vorlage in 1.3 bereits eingebaut.
