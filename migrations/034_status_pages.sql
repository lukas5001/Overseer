-- Migration 034: Public Status Pages
-- Tables for status pages, components, incidents, uptime tracking, subscribers

CREATE TABLE status_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(63) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#22c55e',
    favicon_url TEXT,
    custom_css TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_status_pages_tenant ON status_pages (tenant_id);
CREATE INDEX idx_status_pages_slug ON status_pages (slug);

CREATE TABLE status_page_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    group_name VARCHAR(255),
    current_status VARCHAR(20) DEFAULT 'operational',
    status_override BOOLEAN DEFAULT false,
    show_uptime BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sp_components_page ON status_page_components (status_page_id);

CREATE TABLE component_check_mappings (
    component_id UUID NOT NULL REFERENCES status_page_components(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (component_id, service_id)
);
CREATE INDEX idx_ccm_service ON component_check_mappings (service_id);

CREATE TABLE status_page_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'investigating',
    impact VARCHAR(20) NOT NULL DEFAULT 'minor',
    is_auto_created BOOLEAN DEFAULT false,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_sp_incidents_page ON status_page_incidents (status_page_id);
CREATE INDEX idx_sp_incidents_status ON status_page_incidents (status) WHERE status != 'resolved';

-- Link incidents to affected components
CREATE TABLE incident_component_links (
    incident_id UUID NOT NULL REFERENCES status_page_incidents(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES status_page_components(id) ON DELETE CASCADE,
    PRIMARY KEY (incident_id, component_id)
);

CREATE TABLE incident_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES status_page_incidents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_incident_updates_incident ON incident_updates (incident_id);

CREATE TABLE component_daily_uptime (
    component_id UUID NOT NULL REFERENCES status_page_components(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    uptime_percentage FLOAT,
    worst_status VARCHAR(20),
    outage_minutes INTEGER DEFAULT 0,
    PRIMARY KEY (component_id, date)
);

CREATE TABLE status_page_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL,
    endpoint VARCHAR(512) NOT NULL,
    confirmed BOOLEAN DEFAULT false,
    confirmation_token UUID DEFAULT gen_random_uuid(),
    component_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sp_subscribers_page ON status_page_subscribers (status_page_id);
