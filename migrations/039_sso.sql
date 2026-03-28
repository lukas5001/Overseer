-- Migration 039: SSO (OIDC + SAML + LDAP)
-- Part of Block 5.3 — Single Sign-On

-- Identity Provider configuration per tenant
CREATE TABLE IF NOT EXISTS tenant_idp_config (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    name            VARCHAR(255)    NOT NULL DEFAULT 'SSO',
    auth_type       VARCHAR(20)     NOT NULL,   -- 'oidc', 'saml', 'ldap'
    email_domains   TEXT[]          NOT NULL DEFAULT '{}',

    -- OIDC fields
    oidc_discovery_url      TEXT,
    oidc_client_id          TEXT,
    oidc_client_secret_enc  TEXT,   -- AES-256-GCM encrypted

    -- SAML fields
    saml_metadata_url       TEXT,
    saml_entity_id          TEXT,
    saml_certificate        TEXT,   -- IdP X.509 certificate (PEM)
    saml_attribute_mapping  JSONB   DEFAULT '{}',

    -- LDAP fields
    ldap_url                TEXT,   -- ldaps://ldap.example.com:636
    ldap_base_dn            TEXT,
    ldap_bind_dn            TEXT,
    ldap_bind_password_enc  TEXT,   -- AES-256-GCM encrypted
    ldap_user_filter        TEXT    DEFAULT '(&(objectClass=user)(mail={email}))',
    ldap_group_attribute    TEXT    DEFAULT 'memberOf',

    -- Common settings
    role_mapping            JSONB   DEFAULT '{"*": "tenant_viewer"}',
    jit_provisioning        BOOLEAN NOT NULL DEFAULT TRUE,
    allow_password_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idp_tenant ON tenant_idp_config (tenant_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_idp_domains ON tenant_idp_config USING GIN (email_domains);

-- SSO fields on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source VARCHAR(20) NOT NULL DEFAULT 'local';
    -- 'local', 'oidc', 'saml', 'ldap'
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id TEXT;
    -- sub claim (OIDC), NameID (SAML), DN (LDAP)
ALTER TABLE users ADD COLUMN IF NOT EXISTS idp_config_id UUID;
    -- which IdP config was used

-- Allow NULL password_hash for SSO-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
