-- Migration 003: Multi-tenant user access
-- Users can now see ALL tenants or SELECTED tenants (instead of exactly one).

-- New column on users: 'all' = sees everything, 'selected' = only linked tenants
ALTER TABLE users ADD COLUMN tenant_access VARCHAR(20) NOT NULL DEFAULT 'selected';

-- Migrate existing data: super_admins get 'all', others keep 'selected'
UPDATE users SET tenant_access = 'all' WHERE role = 'super_admin';

-- For existing users with a tenant_id, create the access row
-- (so they keep seeing their current tenant after migration)

CREATE TABLE user_tenant_access (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX idx_user_tenant_access_user ON user_tenant_access(user_id);
CREATE INDEX idx_user_tenant_access_tenant ON user_tenant_access(tenant_id);

-- Migrate: give each user access to their current tenant_id
INSERT INTO user_tenant_access (user_id, tenant_id)
SELECT id, tenant_id FROM users WHERE tenant_id IS NOT NULL;
