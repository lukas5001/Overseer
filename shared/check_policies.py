"""Global check policy merge logic – used by API (agent config) and Worker (scheduler)."""
from __future__ import annotations

from uuid import UUID


def apply_global_policies(
    check_type: str,
    check_config: dict,
    tenant_id: str | UUID,
    policies: list[dict],
) -> dict:
    """Apply matching global policies to a service's check_config.

    Args:
        check_type: The check type (e.g. 'agent_services_auto').
        check_config: The service's original check_config dict.
        tenant_id: The tenant UUID.
        policies: All enabled policies, sorted by priority ASC.

    Returns:
        New dict with policies merged in.
    """
    tid = str(tenant_id)
    result = dict(check_config)

    for p in policies:
        # Match check_type ('*' = all)
        p_type = p["check_type"]
        if p_type != "*" and p_type != check_type:
            continue

        # Tenant scope filter
        mode = p.get("scope_mode", "all")
        scope_ids = [str(s) for s in (p.get("scope_tenant_ids") or [])]

        if mode == "include_tenants" and tid not in scope_ids:
            continue
        if mode == "exclude_tenants" and tid in scope_ids:
            continue

        # Merge config values
        strategy = p.get("merge_strategy", "merge")
        merge_cfg = p.get("merge_config") or {}

        for key, value in merge_cfg.items():
            existing = result.get(key)

            if isinstance(existing, list) and isinstance(value, list):
                # Arrays: always union (preserving order, deduped)
                combined = list(existing)
                for item in value:
                    if item not in combined:
                        combined.append(item)
                result[key] = combined
            elif strategy == "override":
                # Override: global wins
                result[key] = value
            elif key not in result:
                # Merge: set as default (only if not already present)
                result[key] = value

    return result


# SQL query to load all enabled policies (reused by agent.py and scheduler.py)
LOAD_POLICIES_SQL = """
    SELECT id, check_type, merge_config, merge_strategy,
           scope_mode, scope_tenant_ids, priority
    FROM global_check_policies
    WHERE enabled = true
    ORDER BY priority ASC, created_at ASC
"""
