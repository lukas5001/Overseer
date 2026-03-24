-- Remove WinRM columns from hosts table (replaced by Agent-based monitoring)
ALTER TABLE hosts DROP COLUMN IF EXISTS winrm_username;
ALTER TABLE hosts DROP COLUMN IF EXISTS winrm_password;
ALTER TABLE hosts DROP COLUMN IF EXISTS winrm_transport;
ALTER TABLE hosts DROP COLUMN IF EXISTS winrm_port;
ALTER TABLE hosts DROP COLUMN IF EXISTS winrm_ssl;
