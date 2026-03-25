-- 025: Configurable Host Types
-- Replaces the hardcoded host_type ENUM with a configurable host_types table.

-- 1. Create host_types table
CREATE TABLE host_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL UNIQUE,
    icon VARCHAR(50) NOT NULL DEFAULT 'server',
    category VARCHAR(100) NOT NULL DEFAULT 'Sonstiges',
    agent_capable BOOLEAN NOT NULL DEFAULT false,
    snmp_enabled BOOLEAN NOT NULL DEFAULT false,
    ip_required BOOLEAN NOT NULL DEFAULT false,
    os_family VARCHAR(50),
    sort_order INT NOT NULL DEFAULT 100,
    is_system BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed system defaults with deterministic UUIDs
INSERT INTO host_types (id, name, icon, category, agent_capable, snmp_enabled, ip_required, os_family, sort_order, is_system) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Linux Server',  'server',  'Server',     true,  false, false, 'linux',   10, true),
  ('a0000000-0000-0000-0000-000000000002', 'Windows Server', 'monitor', 'Server',     true,  false, false, 'windows', 20, true),
  ('a0000000-0000-0000-0000-000000000003', 'Switch',         'network', 'Netzwerk',   false, true,  true,  NULL,      30, true),
  ('a0000000-0000-0000-0000-000000000004', 'Router',         'router',  'Netzwerk',   false, true,  true,  NULL,      40, true),
  ('a0000000-0000-0000-0000-000000000005', 'Firewall',       'shield',  'Netzwerk',   false, true,  true,  NULL,      50, true),
  ('a0000000-0000-0000-0000-000000000006', 'Access Point',   'wifi',    'Netzwerk',   false, true,  true,  NULL,      60, true),
  ('a0000000-0000-0000-0000-000000000007', 'Drucker',        'printer', 'Peripherie', false, true,  true,  NULL,      70, true),
  ('a0000000-0000-0000-0000-000000000008', 'Sonstiges',      'box',     'Sonstiges',  false, false, false, NULL,     999, true);

-- 3. Add host_type_id column to hosts (nullable first for migration)
ALTER TABLE hosts ADD COLUMN host_type_id UUID REFERENCES host_types(id);

-- 4. Migrate existing data from old enum to new FK
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000001' WHERE host_type = 'server';
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000003' WHERE host_type = 'switch';
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000004' WHERE host_type = 'router';
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000007' WHERE host_type = 'printer';
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000005' WHERE host_type = 'firewall';
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000006' WHERE host_type = 'access_point';
UPDATE hosts SET host_type_id = 'a0000000-0000-0000-0000-000000000008' WHERE host_type = 'other';

-- 5. Make NOT NULL
ALTER TABLE hosts ALTER COLUMN host_type_id SET NOT NULL;

-- 6. Drop old column and enum type
ALTER TABLE hosts DROP COLUMN host_type;
DROP TYPE IF EXISTS host_type;

-- 7. Index for FK lookups
CREATE INDEX idx_hosts_host_type_id ON hosts (host_type_id);
