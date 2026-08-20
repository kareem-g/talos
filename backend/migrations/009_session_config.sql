-- Per-session provider configuration (model, mode, effort, and whatever else a
-- provider exposes).
--
-- Stored as rows rather than columns because config dimensions are provider-
-- defined and open-ended: opencode reports `model` and `mode`, codex reports a
-- sandbox setting, and a provider added tomorrow may report something nobody has
-- named yet. A `model TEXT` column would have to be widened for each one.
--
-- These are *requested* values. The live agent remains the authority on what is
-- actually active; this table exists so a request survives a restart and can be
-- applied when the session next spawns.
CREATE TABLE IF NOT EXISTS session_config (
    session_id TEXT NOT NULL,
    -- Provider-native option id, passed back to the provider verbatim.
    config_id TEXT NOT NULL,
    -- Opaque provider-native value. Model ids may contain slashes and colons;
    -- nothing parses this.
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, config_id)
);

CREATE INDEX IF NOT EXISTS idx_session_config_session ON session_config(session_id);
