-- Link a child session to the session that spawned it.
--
-- Subagents (and multi-agent fan-out) create real session rows that show up in
-- the workspace lists like any other run. `parent_id` records the spawning
-- session so the harness can (a) cascade cancellation: killing a parent stops
-- its in-flight children instead of orphaning them, and (b) tell spawned rows
-- apart in the UI. Opaque session id, never parsed.

ALTER TABLE sessions ADD COLUMN parent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_parent
    ON sessions(parent_id)
    WHERE parent_id IS NOT NULL;
