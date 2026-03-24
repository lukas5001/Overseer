# Overseer – Improvements Prompts

Aufgaben die ohne User-Entscheidungen umsetzbar sind.
Sortiert nach Priorität und Aufwand.

---

## 1. [KRITISCH/KLEIN] datetime.utcnow() → datetime.now(timezone.utc)

Alle `datetime.utcnow()` durch `datetime.now(timezone.utc)` ersetzen.
Python 3.12 deprecated, erzeugt naive datetimes.

```
grep -r "utcnow()" api/ worker/ receiver/ shared/
```

---

## 2. [KRITISCH/KLEIN] 404-Route im Frontend

`frontend/src/App.tsx` – Catch-all Route hinzufügen die eine "Seite nicht gefunden" anzeigt.

---

## 3. [HOCH/KLEIN] React Error Boundary

Eine `ErrorBoundary`-Komponente erstellen und um die App wrappen.
Bei JS-Fehler soll eine Fehlermeldung statt einer leeren Seite erscheinen.

---

## 4. [HOCH/KLEIN] Status-Update-Logik deduplizieren

Die Soft/Hard-State-Machine-Logik existiert identisch in:
- `worker/app/scheduler.py` (_execute_check)
- `api/app/routers/services.py` (check_now)

→ In `shared/` eine Funktion `compute_new_state()` extrahieren.

---

## 5. ✅ ERLEDIGT — SNMP-Credential-Injection dedupliziert

WinRM wurde komplett entfernt (ersetzt durch Agent-basiertes Monitoring).
SNMP-Credential-Injection ist in `shared/status.py` → `inject_host_credentials()` zentralisiert.

---

## 6. [HOCH/MITTEL] Pagination für Services-Endpoint

`GET /api/v1/services/` hat kein Limit/Offset. Analog zu Hosts-Endpoint ergänzen:
- `limit` Parameter (default 50, max 500)
- `offset` Parameter
- `X-Total-Count` Header

---

## 7. [HOCH/MITTEL] Audit-Logging erweitern

Folgende Aktionen loggen (analog zu host_create):
- service_create, service_update, service_delete
- host_update, host_delete
- tenant_create, tenant_update, tenant_delete
- downtime_create, downtime_delete
- acknowledgement_create, acknowledgement_clear

---

## 8. [MITTEL/KLEIN] Frontend StatusBadge-Komponente extrahieren

Status-Badges (OK/WARNING/CRITICAL/UNKNOWN) werden in 5+ Seiten inline gerendert.
→ `frontend/src/components/StatusBadge.tsx` erstellen und überall verwenden.

---

## 9. [MITTEL/KLEIN] API Health-Endpoint

`GET /api/v1/health` der DB- und Redis-Konnektivität prüft. Kann für Self-Monitoring verwendet werden.

---

## 10. [MITTEL/KLEIN] Frontend-Konstanten synchronisieren

Check-Typen, Status-Farben und ähnliche Konstanten aus einer einzigen Quelle ableiten.
Aktuell: Frontend hat eigene Listen die manuell synchron gehalten werden.

---

## 11. [MITTEL/MITTEL] Worker Race-Condition entschärfen

`current_status` UPDATE mit `WHERE status = :prev_status` ergänzen um Lost Updates zu vermeiden.
Oder: PostgreSQL Advisory Locks pro service_id verwenden.

---

## 12. [NIEDRIG/KLEIN] unused imports aufräumen

Diverse unused imports in Python-Dateien.

---

## 13. [NIEDRIG/KLEIN] Konsistente Logger-Namen

Logger-Namen standardisieren: `overseer.<component>.<module>` Pattern.

---

## 14. [NIEDRIG/MITTEL] Frontend Loading States vereinheitlichen

Aktuell: Verschiedene Loading-Spinner/Skeletons pro Seite.
→ Einheitliche `<LoadingSpinner />` Komponente.
