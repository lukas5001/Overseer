-- Migration 008: Two-Factor Authentication
-- Adds optional 2FA support (TOTP or email-based) to the users table.

ALTER TABLE users ADD COLUMN two_fa_method VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE users ADD COLUMN two_fa_secret TEXT;
ALTER TABLE users ADD COLUMN two_fa_email_code VARCHAR(6);
ALTER TABLE users ADD COLUMN two_fa_email_code_expires_at TIMESTAMPTZ;
