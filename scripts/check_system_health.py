#!/usr/bin/env python3
"""
Overseer System Health Check – monitors the full pipeline for bottlenecks.

Checks:
  1. Redis Stream depth (are messages backing up?)
  2. Worker processing rate (checks/second)
  3. Non-OK statuses (should be 0 in fixed-OK mode)
  4. Collector freshness (last_seen_at lag)
  5. PostgreSQL stats (connections, table sizes, dead tuples)
  6. System resources (CPU, RAM, disk)
  7. check_results growth rate

Usage:
    python scripts/check_system_health.py                     # one-shot
    python scripts/check_system_health.py --watch             # repeat every 10s
    python scripts/check_system_health.py --watch --interval 5
"""
import argparse
import os
import sys
import time
from datetime import datetime, timezone

import psycopg2
import redis

DB_URL = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://overseer:overseer_dev_password@localhost:5432/overseer",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
STREAM_NAME = "overseer:check_results"
DEAD_LETTER_STREAM = "overseer:dead-letters"


def check_redis(r):
    """Check Redis stream depth and dead letters."""
    print("── Redis ──")

    # Stream length
    try:
        stream_len = r.xlen(STREAM_NAME)
    except Exception:
        stream_len = 0

    status = "OK" if stream_len < 100 else ("WARNING" if stream_len < 1000 else "CRITICAL")
    print(f"  Stream Tiefe:     {stream_len:>8}  [{status}]")
    if stream_len > 0:
        # Check oldest message age
        try:
            msgs = r.xrange(STREAM_NAME, count=1)
            if msgs:
                msg_id = msgs[0][0]
                ts_ms = int(msg_id.split("-")[0])
                age_s = (time.time() * 1000 - ts_ms) / 1000
                status = "OK" if age_s < 5 else ("WARNING" if age_s < 30 else "CRITICAL")
                print(f"  Älteste Nachricht: {age_s:>7.1f}s  [{status}]")
        except Exception as e:
            print(f"  Älteste Nachricht: Fehler ({e})")

    # Dead letters
    try:
        dead_len = r.xlen(DEAD_LETTER_STREAM)
    except Exception:
        dead_len = 0
    status = "OK" if dead_len == 0 else "CRITICAL"
    print(f"  Dead Letters:     {dead_len:>8}  [{status}]")

    # Redis memory
    info = r.info("memory")
    used_mb = info["used_memory"] / 1024 / 1024
    print(f"  Redis Memory:     {used_mb:>7.1f}MB")

    return stream_len


def check_db(cur):
    """Check database health."""
    print("\n── PostgreSQL ──")

    # Total checks
    cur.execute("SELECT COUNT(*) FROM current_status")
    total = cur.fetchone()[0]
    print(f"  Checks total:     {total:>8}")

    # Non-OK checks (should be 0 in fixed-OK mode)
    cur.execute("""
        SELECT status, COUNT(*) FROM current_status
        WHERE status != 'OK'
        GROUP BY status ORDER BY status
    """)
    non_ok = cur.fetchall()
    if non_ok:
        print(f"  ⚠ NICHT-OK STATUS GEFUNDEN:")
        for status, cnt in non_ok:
            print(f"      {status}: {cnt}")
    else:
        print(f"  Non-OK Checks:    {0:>8}  [OK]")

    # UNKNOWN checks specifically (= worker/collector problem)
    cur.execute("SELECT COUNT(*) FROM current_status WHERE status = 'UNKNOWN'")
    unknown = cur.fetchone()[0]
    if unknown > 0:
        print(f"  ⚠ UNKNOWN:        {unknown:>8}  [CRITICAL] – Worker kommt nicht nach oder Collector offline!")

    # Checks not updated recently (stale > 2 minutes)
    cur.execute("""
        SELECT COUNT(*) FROM current_status
        WHERE last_check_at < NOW() - INTERVAL '2 minutes'
    """)
    stale = cur.fetchone()[0]
    status = "OK" if stale == 0 else ("WARNING" if stale < 100 else "CRITICAL")
    print(f"  Stale (>2min):    {stale:>8}  [{status}]")

    # Checks not updated recently (stale > 5 minutes)
    cur.execute("""
        SELECT COUNT(*) FROM current_status
        WHERE last_check_at < NOW() - INTERVAL '5 minutes'
    """)
    stale5 = cur.fetchone()[0]
    if stale5 > 0:
        print(f"  Stale (>5min):    {stale5:>8}  [CRITICAL]")

    # check_results table size
    cur.execute("""
        SELECT COUNT(*) FROM check_results
        WHERE time > NOW() - INTERVAL '1 hour'
    """)
    results_1h = cur.fetchone()[0]
    print(f"  check_results/1h: {results_1h:>8}")

    cur.execute("""
        SELECT COUNT(*) FROM check_results
    """)
    results_total = cur.fetchone()[0]
    print(f"  check_results:    {results_total:>8} total")

    # Table sizes
    cur.execute("""
        SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 8
    """)
    print(f"\n  Tabellengrößen:")
    for name, size in cur.fetchall():
        print(f"    {name:<25s} {size:>10s}")

    # Active connections
    cur.execute("SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'")
    active = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM pg_stat_activity")
    total_conn = cur.fetchone()[0]
    cur.execute("SHOW max_connections")
    max_conn = int(cur.fetchone()[0])
    pct = total_conn / max_conn * 100
    status = "OK" if pct < 70 else ("WARNING" if pct < 90 else "CRITICAL")
    print(f"\n  Connections:      {total_conn:>3}/{max_conn} ({pct:.0f}%)  [{status}]")
    print(f"  Active Queries:   {active:>8}")

    # Dead tuples (vacuum pressure)
    cur.execute("""
        SELECT relname, n_dead_tup
        FROM pg_stat_user_tables
        WHERE n_dead_tup > 1000
        ORDER BY n_dead_tup DESC
        LIMIT 5
    """)
    dead = cur.fetchall()
    if dead:
        print(f"\n  Dead Tuples (>1k):")
        for name, cnt in dead:
            print(f"    {name:<25s} {cnt:>10}")

    return total, non_ok, stale


def check_collectors(cur):
    """Check collector freshness."""
    print("\n── Collectors ──")

    cur.execute("""
        SELECT name,
               EXTRACT(EPOCH FROM (NOW() - last_seen_at))::int AS age_seconds
        FROM collectors
        WHERE active = true
        ORDER BY last_seen_at ASC
        LIMIT 10
    """)
    rows = cur.fetchall()
    stale_collectors = 0
    for name, age in rows:
        if age > 180:  # > 3 minutes
            print(f"  ⚠ {name}: {age}s seit letztem Kontakt [OFFLINE]")
            stale_collectors += 1

    if stale_collectors == 0:
        cur.execute("SELECT COUNT(*) FROM collectors WHERE active = true")
        total = cur.fetchone()[0]
        # Show oldest
        if rows:
            oldest_age = max(r[1] for r in rows)
            print(f"  Alle {total} Collectors online (ältester: {oldest_age}s)")
        else:
            print(f"  {total} Collectors registriert")

    return stale_collectors


def check_system():
    """Check system resources."""
    print("\n── System ──")

    # CPU load
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
            load1, load5, load15 = float(parts[0]), float(parts[1]), float(parts[2])

        import multiprocessing
        cores = multiprocessing.cpu_count()
        pct = load1 / cores * 100
        status = "OK" if pct < 70 else ("WARNING" if pct < 90 else "CRITICAL")
        print(f"  CPU Load:         {load1:.1f} / {load5:.1f} / {load15:.1f}  ({cores} cores, {pct:.0f}%)  [{status}]")
    except Exception:
        print(f"  CPU Load:         nicht lesbar")

    # Memory
    try:
        with open("/proc/meminfo") as f:
            lines = f.readlines()
        mem = {}
        for line in lines:
            parts = line.split()
            mem[parts[0].rstrip(":")] = int(parts[1])

        total_mb = mem["MemTotal"] / 1024
        avail_mb = mem.get("MemAvailable", mem.get("MemFree", 0)) / 1024
        used_pct = (1 - avail_mb / total_mb) * 100
        status = "OK" if used_pct < 80 else ("WARNING" if used_pct < 90 else "CRITICAL")
        print(f"  RAM:              {used_pct:.0f}% von {total_mb:.0f}MB  [{status}]")
    except Exception:
        print(f"  RAM:              nicht lesbar")

    # Disk
    try:
        st = os.statvfs("/")
        total_gb = st.f_blocks * st.f_frsize / 1024**3
        free_gb = st.f_bavail * st.f_frsize / 1024**3
        used_pct = (1 - free_gb / total_gb) * 100
        status = "OK" if used_pct < 80 else ("WARNING" if used_pct < 90 else "CRITICAL")
        print(f"  Disk /:           {used_pct:.0f}% von {total_gb:.0f}GB  ({free_gb:.1f}GB frei)  [{status}]")
    except Exception:
        print(f"  Disk:             nicht lesbar")


def run_check(db_url, redis_url):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n{'='*60}")
    print(f"  Overseer System Health Check – {ts}")
    print(f"{'='*60}")

    # Redis
    r = redis.from_url(redis_url, decode_responses=True)
    stream_depth = check_redis(r)
    r.close()

    # PostgreSQL
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    total, non_ok, stale = check_db(cur)
    stale_collectors = check_collectors(cur)
    cur.close()
    conn.close()

    # System
    check_system()

    # Summary
    print(f"\n{'='*60}")
    problems = []
    if stream_depth > 100:
        problems.append(f"Redis Stream Stau: {stream_depth} Nachrichten")
    if non_ok:
        total_non_ok = sum(cnt for _, cnt in non_ok)
        problems.append(f"{total_non_ok} Checks nicht OK")
    if stale > 0:
        problems.append(f"{stale} Checks veraltet (>2min)")
    if stale_collectors > 0:
        problems.append(f"{stale_collectors} Collectors offline")

    if problems:
        print(f"  ⚠ PROBLEME GEFUNDEN:")
        for p in problems:
            print(f"    • {p}")
    else:
        print(f"  ✓ Alles OK – {total} Checks, Pipeline läuft einwandfrei")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="Overseer System Health Check")
    parser.add_argument("--db-url", default=DB_URL)
    parser.add_argument("--redis-url", default=REDIS_URL)
    parser.add_argument("--watch", action="store_true", help="Repeat continuously")
    parser.add_argument("--interval", type=int, default=10, help="Watch interval (seconds)")
    args = parser.parse_args()

    if args.watch:
        while True:
            run_check(args.db_url, args.redis_url)
            time.sleep(args.interval)
    else:
        run_check(args.db_url, args.redis_url)


if __name__ == "__main__":
    main()
