"""
Shared state-machine logic for Soft/Hard state computation.

Used by:
- Active Check Scheduler (worker/app/scheduler.py)
- "Check Now" API endpoint (api/app/routers/services.py)
"""
from dataclasses import dataclass


@dataclass
class StateResult:
    """Result of computing the new state after a check."""
    state_type: str        # "HARD" or "SOFT"
    attempt: int           # current attempt counter
    state_changed: bool    # whether status or state_type changed


def compute_new_state(
    new_status: str,
    prev_status: str | None,
    prev_state_type: str | None,
    current_attempt: int,
    max_attempts: int,
) -> StateResult:
    """Compute new Soft/Hard state from a check result.

    When there is no previous state (first check), pass prev_status=None.
    """
    if prev_status is None:
        # First check ever for this service
        if new_status == "OK":
            return StateResult(state_type="HARD", attempt=0, state_changed=True)
        return StateResult(state_type="SOFT", attempt=1, state_changed=True)

    if new_status == "OK":
        new_state_type = "HARD"
        new_attempt = 0
    else:
        new_attempt = current_attempt + 1
        if prev_state_type == "HARD" and prev_status != "OK":
            # Already in a HARD failure state – stays HARD
            new_state_type = "HARD"
        else:
            new_state_type = "HARD" if new_attempt >= max_attempts else "SOFT"

    state_changed = (new_status != prev_status) or (new_state_type != prev_state_type)
    return StateResult(
        state_type=new_state_type,
        attempt=new_attempt,
        state_changed=state_changed,
    )


def inject_host_credentials(check_type: str, config: dict, host) -> dict:
    """Inject host-level SNMP/WinRM credentials into check config.

    `host` can be any object with snmp_community, snmp_version,
    winrm_username, winrm_password, winrm_transport, winrm_port, winrm_ssl
    attributes (ORM model, named tuple from raw SQL, etc.).

    Returns the modified config dict (mutates in place for convenience).
    """
    if check_type in ("snmp", "snmp_interface"):
        config.setdefault("community", getattr(host, "snmp_community", None) or "public")
        config.setdefault("version", getattr(host, "snmp_version", None) or "2c")

    if check_type.startswith("winrm_"):
        config.setdefault("username", getattr(host, "winrm_username", None) or "")
        config.setdefault("password", getattr(host, "winrm_password", None) or "")
        config.setdefault("transport", getattr(host, "winrm_transport", None) or "ntlm")
        config.setdefault("port", getattr(host, "winrm_port", None) or 5986)
        winrm_ssl = getattr(host, "winrm_ssl", None)
        config.setdefault("ssl", winrm_ssl if winrm_ssl is not None else True)

    return config
