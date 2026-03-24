-- 2FA Hardening: code hash, attempt tracking, lockout
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS two_fa_email_code_hash TEXT,
    ADD COLUMN IF NOT EXISTS two_fa_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS two_fa_lockout_until TIMESTAMPTZ;

-- Altes Plaintext-Feld leeren (Migration setzt Codes auf null)
UPDATE users SET two_fa_email_code = NULL;
