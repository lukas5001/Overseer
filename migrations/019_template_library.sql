-- 019: Template Library – add vendor/category/built_in/tags to service_templates
ALTER TABLE service_templates
  ADD COLUMN IF NOT EXISTS vendor       TEXT    NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS category     TEXT    NOT NULL DEFAULT 'server',
  ADD COLUMN IF NOT EXISTS built_in     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tags         TEXT[]  NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_templates_vendor   ON service_templates(vendor);
CREATE INDEX IF NOT EXISTS idx_templates_category ON service_templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_built_in ON service_templates(built_in);
