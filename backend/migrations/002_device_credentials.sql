ALTER TABLE devices ADD COLUMN token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN revoked_at DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
