DROP INDEX IF EXISTS idx_devices_token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash) WHERE token_hash <> '';
