"""Tests for SSL certificate notification staffelung logic."""
from datetime import datetime, timedelta, timezone

from shared.ssl_notification import (
    compute_ssl_stage,
    should_notify,
    is_renewal,
    build_ssl_notification_context,
    render_ssl_notification_html,
)


# ==================== compute_ssl_stage ====================

def test_stage_expired():
    assert compute_ssl_stage(0) == "expired"
    assert compute_ssl_stage(-5) == "expired"

def test_stage_3d():
    assert compute_ssl_stage(1) == "3d"
    assert compute_ssl_stage(3) == "3d"

def test_stage_7d():
    assert compute_ssl_stage(4) == "7d"
    assert compute_ssl_stage(7) == "7d"

def test_stage_14d():
    assert compute_ssl_stage(8) == "14d"
    assert compute_ssl_stage(14) == "14d"

def test_stage_30d():
    assert compute_ssl_stage(15) == "30d"
    assert compute_ssl_stage(30) == "30d"

def test_stage_none_healthy():
    assert compute_ssl_stage(31) is None
    assert compute_ssl_stage(90) is None
    assert compute_ssl_stage(365) is None


# ==================== should_notify ====================

def test_notify_first_warning_at_30d():
    """First time reaching 30d stage -> always notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    assert should_notify("30d", None, None, now) is True

def test_no_renotify_between_30_and_15_days():
    """Same 30d stage, no re-notification (no re-notify interval for 30d)."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=12)
    assert should_notify("30d", "30d", last, now) is False

def test_no_renotify_30d_even_after_long_time():
    """30d stage has no re-notification interval, even after days."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(days=10)
    assert should_notify("30d", "30d", last, now) is False

def test_notify_at_14d():
    """Stage worsens from 30d to 14d -> notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(days=5)
    assert should_notify("14d", "30d", last, now) is True

def test_no_renotify_14d():
    """Same 14d stage, no re-notification (no interval for 14d)."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=12)
    assert should_notify("14d", "14d", last, now) is False

def test_notify_at_7d_stage_change():
    """Stage worsens from 14d to 7d -> notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    assert should_notify("7d", "14d", now - timedelta(days=1), now) is True

def test_renotify_7d_after_24h():
    """7d stage, last notified >24h ago -> re-notify (daily)."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=25)
    assert should_notify("7d", "7d", last, now) is True

def test_no_renotify_7d_before_24h():
    """7d stage, last notified <24h ago -> don't re-notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=12)
    assert should_notify("7d", "7d", last, now) is False

def test_notify_at_3d_stage_change():
    """Stage worsens from 7d to 3d -> notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    assert should_notify("3d", "7d", now - timedelta(hours=6), now) is True

def test_renotify_3d_after_12h():
    """3d stage, last notified >12h ago -> re-notify (every 12h)."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=13)
    assert should_notify("3d", "3d", last, now) is True

def test_no_renotify_3d_before_12h():
    """3d stage, last notified <12h ago -> don't re-notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=6)
    assert should_notify("3d", "3d", last, now) is False

def test_notify_expired_stage_change():
    """Stage worsens from 3d to expired -> notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    assert should_notify("expired", "3d", now - timedelta(hours=1), now) is True

def test_renotify_expired_after_6h():
    """Expired, last notified >6h ago -> re-notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=7)
    assert should_notify("expired", "expired", last, now) is True

def test_no_renotify_expired_before_6h():
    """Expired, last notified <6h ago -> don't re-notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    last = now - timedelta(hours=3)
    assert should_notify("expired", "expired", last, now) is False

def test_no_notify_when_healthy():
    """Stage is None (healthy cert) -> never notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    assert should_notify(None, None, None, now) is False
    assert should_notify(None, "30d", now - timedelta(days=1), now) is False

def test_notify_first_time_no_last_notified():
    """First time at a stage with no prior notification -> notify."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)
    assert should_notify("14d", "14d", None, now) is True


# ==================== is_renewal ====================

def test_renewal_detected():
    """days_until_expiry jumps from 5 to 90 -> renewal."""
    assert is_renewal(90, 5) is True

def test_renewal_large_jump():
    """days_until_expiry jumps from 2 to 365 -> renewal."""
    assert is_renewal(365, 2) is True

def test_no_renewal_small_change():
    """days_until_expiry decreases by 1 -> not renewal."""
    assert is_renewal(29, 30) is False

def test_no_renewal_same_value():
    assert is_renewal(30, 30) is False

def test_no_renewal_small_increase():
    """Small increase (< threshold of 10) -> not renewal (timing jitter)."""
    assert is_renewal(32, 30) is False

def test_no_renewal_first_check():
    """No previous value -> not renewal."""
    assert is_renewal(90, None) is False

def test_renewal_boundary():
    """Exactly at threshold (11 day increase) -> renewal."""
    assert is_renewal(41, 30) is True

def test_no_renewal_at_threshold():
    """Exactly 10 day increase -> NOT renewal (needs > 10)."""
    assert is_renewal(40, 30) is False


# ==================== build_ssl_notification_context ====================

def test_context_warning():
    ctx = build_ssl_notification_context(
        host="api.example.com",
        service_name="ssl_check",
        check_message="Expires in 25 days",
        metadata={"days_until_expiry": 25, "not_after": "2026-04-21", "issuer": "Let's Encrypt", "subject": "api.example.com"},
        stage="30d",
    )
    assert ctx["status"] == "WARNING"
    assert ctx["host"] == "api.example.com"
    assert ctx["days_until_expiry"] == 25

def test_context_critical():
    ctx = build_ssl_notification_context(
        host="api.example.com",
        service_name="ssl_check",
        check_message="Expires in 5 days",
        metadata={"days_until_expiry": 5, "not_after": "2026-04-01"},
        stage="7d",
    )
    assert ctx["status"] == "CRITICAL"

def test_context_expired():
    ctx = build_ssl_notification_context(
        host="api.example.com",
        service_name="ssl_check",
        check_message="EXPIRED 3 days ago",
        metadata={"days_until_expiry": -3},
        stage="expired",
    )
    assert ctx["status"] == "CRITICAL"

def test_context_recovery():
    ctx = build_ssl_notification_context(
        host="api.example.com",
        service_name="ssl_check",
        check_message="Valid for 90 days",
        metadata={"days_until_expiry": 90, "not_after": "2026-06-25"},
        stage="renewal",
        is_recovery=True,
    )
    assert ctx["status"] == "OK"
    assert ctx["is_recovery"] is True
    assert "renewed" in ctx["message"]


# ==================== render_ssl_notification_html ====================

def test_render_html_contains_key_info():
    ctx = {
        "status": "WARNING",
        "host": "api.example.com",
        "service_name": "ssl_check",
        "message": "Expires in 25 days",
        "days_until_expiry": 25,
        "not_after": "2026-04-21",
        "issuer": "Let's Encrypt",
        "subject": "api.example.com",
        "is_recovery": False,
    }
    html = render_ssl_notification_html(ctx)
    assert "api.example.com" in html
    assert "25" in html
    assert "2026-04-21" in html
    assert "Let's Encrypt" in html
    assert "WARNING" in html

def test_render_html_recovery():
    ctx = {
        "status": "OK",
        "host": "api.example.com",
        "service_name": "ssl_check",
        "message": "Certificate renewed",
        "is_recovery": True,
    }
    html = render_ssl_notification_html(ctx)
    assert "RECOVERY" in html
    assert "#16a34a" in html  # green color


# ==================== Integration: full staffelung scenario ====================

def test_full_staffelung_scenario():
    """Simulate a certificate approaching expiry through all stages."""
    now = datetime(2026, 3, 1, tzinfo=timezone.utc)

    # Day 1: cert has 35 days -> no stage, no notification
    stage = compute_ssl_stage(35)
    assert stage is None
    assert should_notify(stage, None, None, now) is False

    # Day 6: cert has 30 days -> 30d stage, first notification
    stage = compute_ssl_stage(30)
    assert stage == "30d"
    assert should_notify(stage, None, None, now) is True
    last_notified = now

    # Day 7: cert has 29 days -> still 30d, no re-notification
    now2 = now + timedelta(days=1)
    stage = compute_ssl_stage(29)
    assert stage == "30d"
    assert should_notify(stage, "30d", last_notified, now2) is False

    # Day 21: cert has 14 days -> 14d stage, notification
    now3 = now + timedelta(days=16)
    stage = compute_ssl_stage(14)
    assert stage == "14d"
    assert should_notify(stage, "30d", last_notified, now3) is True
    last_notified = now3

    # Day 24: cert has 7 days -> 7d stage, notification
    now4 = now + timedelta(days=23)
    stage = compute_ssl_stage(7)
    assert stage == "7d"
    assert should_notify(stage, "14d", last_notified, now4) is True
    last_notified = now4

    # Day 25 (12h later): still 7d, <24h -> no notification
    now5 = now4 + timedelta(hours=12)
    stage = compute_ssl_stage(6)
    assert should_notify(stage, "7d", last_notified, now5) is False

    # Day 25 (25h later): still 7d, >24h -> daily re-notification
    now6 = now4 + timedelta(hours=25)
    assert should_notify("7d", "7d", last_notified, now6) is True
    last_notified = now6

    # Day 28: cert has 3 days -> 3d stage, notification
    now7 = now + timedelta(days=27)
    stage = compute_ssl_stage(3)
    assert stage == "3d"
    assert should_notify(stage, "7d", last_notified, now7) is True
    last_notified = now7

    # 6h later: still 3d, <12h -> no notification
    now8 = now7 + timedelta(hours=6)
    assert should_notify("3d", "3d", last_notified, now8) is False

    # 13h later: still 3d, >12h -> re-notification
    now9 = now7 + timedelta(hours=13)
    assert should_notify("3d", "3d", last_notified, now9) is True
    last_notified = now9

    # Day 31: expired -> notification
    now10 = now + timedelta(days=30)
    stage = compute_ssl_stage(0)
    assert stage == "expired"
    assert should_notify(stage, "3d", last_notified, now10) is True
    last_notified = now10

    # 3h later: still expired, <6h -> no notification
    now11 = now10 + timedelta(hours=3)
    assert should_notify("expired", "expired", last_notified, now11) is False

    # 7h later: still expired, >6h -> re-notification
    now12 = now10 + timedelta(hours=7)
    assert should_notify("expired", "expired", last_notified, now12) is True


def test_renewal_resets_staffelung():
    """After renewal, state resets and no stage notification until 30d again."""
    now = datetime(2026, 3, 27, tzinfo=timezone.utc)

    # Was at 5 days, now at 90 -> renewal
    assert is_renewal(90, 5) is True

    # After reset, new stage should be None (healthy cert)
    stage = compute_ssl_stage(90)
    assert stage is None
    assert should_notify(stage, None, None, now) is False
