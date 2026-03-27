"""Chart generator — creates SVG charts with Plotly for PDF reports."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import plotly.graph_objects as go
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Colors matching the Overseer dark theme
COLORS = {
    "green": "#22c55e",
    "yellow": "#eab308",
    "red": "#ef4444",
    "blue": "#3b82f6",
    "gray": "#6b7280",
    "bg": "#ffffff",
    "text": "#1f2937",
    "grid": "#e5e7eb",
}

CHART_WIDTH = 700
CHART_HEIGHT = 300

_LAYOUT_BASE = dict(
    font=dict(family="Inter, Roboto, sans-serif", size=11, color=COLORS["text"]),
    paper_bgcolor=COLORS["bg"],
    plot_bgcolor=COLORS["bg"],
    margin=dict(l=50, r=20, t=30, b=40),
    xaxis=dict(gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
    yaxis=dict(gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
)


def _to_svg(fig: go.Figure) -> str:
    """Render a Plotly figure to SVG string."""
    return fig.to_image(format="svg", width=CHART_WIDTH, height=CHART_HEIGHT).decode("utf-8")


def generate_uptime_bar_chart(
    services: list[dict],
    title: str = "Service Availability",
) -> str:
    """Horizontal bar chart of service uptime percentages.

    services: list of {"name": str, "sla_pct": float, "target": float|None}
    """
    names = [s["name"] for s in services]
    values = [s["sla_pct"] for s in services]
    colors = []
    for s in services:
        pct = s["sla_pct"]
        if pct >= 99.9:
            colors.append(COLORS["green"])
        elif pct >= 99:
            colors.append(COLORS["yellow"])
        else:
            colors.append(COLORS["red"])

    fig = go.Figure(go.Bar(
        x=values,
        y=names,
        orientation="h",
        marker_color=colors,
        text=[f"{v:.2f}%" for v in values],
        textposition="auto",
        textfont=dict(size=10),
    ))
    fig.update_layout(
        **_LAYOUT_BASE,
        title=dict(text=title, font=dict(size=13)),
        xaxis=dict(range=[min(90, min(values) - 1) if values else 90, 100.1], title="Availability %",
                   gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
        yaxis=dict(autorange="reversed", gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
        height=max(200, len(services) * 35 + 80),
    )

    # Add SLA target lines
    for i, s in enumerate(services):
        if s.get("target"):
            fig.add_shape(
                type="line", x0=s["target"], x1=s["target"],
                y0=i - 0.4, y1=i + 0.4,
                line=dict(color=COLORS["red"], width=2, dash="dash"),
            )

    return _to_svg(fig)


async def generate_performance_timeseries(
    db: AsyncSession,
    service_ids: list[UUID],
    ts_start: datetime,
    ts_end: datetime,
    svc_names: dict[str, str],
    title: str = "Performance",
    value_label: str = "Value",
) -> str:
    """Line chart of service performance over time from aggregate views."""
    span_days = (ts_end - ts_start).total_seconds() / 86400
    if span_days > 30:
        table = "metrics_daily"
    elif span_days > 3:
        table = "metrics_hourly"
    else:
        table = "metrics_5m"

    rows = (await db.execute(text(f"""
        SELECT bucket, service_id, avg_val
        FROM {table}
        WHERE service_id = ANY(:sids) AND bucket >= :ts AND bucket <= :te
        ORDER BY service_id, bucket
    """), {"sids": service_ids, "ts": ts_start, "te": ts_end})).fetchall()

    # Group by service
    by_svc: dict[str, tuple[list, list]] = {}
    for r in rows:
        sid = str(r.service_id)
        if sid not in by_svc:
            by_svc[sid] = ([], [])
        by_svc[sid][0].append(r.bucket)
        by_svc[sid][1].append(r.avg_val)

    palette = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"]
    fig = go.Figure()
    for i, (sid, (times, vals)) in enumerate(by_svc.items()):
        fig.add_trace(go.Scatter(
            x=times, y=vals,
            mode="lines",
            name=svc_names.get(sid, sid)[:30],
            line=dict(color=palette[i % len(palette)], width=2),
        ))

    fig.update_layout(
        **_LAYOUT_BASE,
        title=dict(text=title, font=dict(size=13)),
        yaxis=dict(title=value_label, gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
        xaxis=dict(gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
        legend=dict(orientation="h", yanchor="bottom", y=-0.3, font=dict(size=9)),
        height=CHART_HEIGHT,
    )
    return _to_svg(fig)


def generate_health_gauge(score: float | None) -> str:
    """Gauge chart for health score (0-100)."""
    val = score if score is not None else 0
    color = COLORS["green"] if val >= 99 else COLORS["yellow"] if val >= 95 else COLORS["red"]

    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=val,
        number=dict(suffix="%", font=dict(size=36)),
        gauge=dict(
            axis=dict(range=[0, 100], tickwidth=1),
            bar=dict(color=color),
            steps=[
                dict(range=[0, 95], color="#fee2e2"),
                dict(range=[95, 99], color="#fef3c7"),
                dict(range=[99, 100], color="#dcfce7"),
            ],
            threshold=dict(line=dict(color="black", width=2), thickness=0.75, value=val),
        ),
    ))
    fig.update_layout(
        font=dict(family="Inter, Roboto, sans-serif", size=11, color=COLORS["text"]),
        paper_bgcolor=COLORS["bg"],
        margin=dict(l=30, r=30, t=20, b=10),
        height=200,
        width=300,
    )
    return _to_svg(fig)


def generate_incident_timeline(incidents: list[dict], title: str = "Incidents") -> str | None:
    """Gantt-style timeline of incidents. Returns None if no incidents."""
    if not incidents:
        return None

    fig = go.Figure()
    colors_map = {"CRITICAL": COLORS["red"], "WARNING": COLORS["yellow"]}

    for i, inc in enumerate(incidents[:20]):
        fig.add_trace(go.Bar(
            x=[inc["duration_minutes"]],
            y=[f"{inc['service_name']} ({inc['started_at']:%H:%M})"],
            orientation="h",
            marker_color=colors_map.get(inc["severity"], COLORS["gray"]),
            name=inc["severity"] if i < 2 else None,
            showlegend=i < 2,
            text=f"{inc['duration_minutes']:.0f} min",
            textposition="auto",
            textfont=dict(size=9),
        ))

    fig.update_layout(
        **_LAYOUT_BASE,
        title=dict(text=title, font=dict(size=13)),
        xaxis=dict(title="Dauer (Minuten)", gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
        yaxis=dict(autorange="reversed", gridcolor=COLORS["grid"], linecolor=COLORS["grid"]),
        barmode="stack",
        height=max(200, len(incidents[:20]) * 30 + 80),
        showlegend=True,
    )
    return _to_svg(fig)
