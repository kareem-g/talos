-- Link a local session row to a session that already exists inside a CLI's own
-- storage.
--
-- Agent CLIs keep their own history: `~/.codex/sessions/**/rollout-*.jsonl`,
-- `~/.claude/projects/*/<uuid>.jsonl`, opencode's internal store. Those sessions
-- are real work a user did outside this app, and they are resumable — so they
-- should be visible here rather than invisible until recreated.
--
-- `external_id` is the CLI's own identifier, opaque and never parsed.
-- `source` records how the row arrived, so an imported session can be told apart
-- from one this app created and its resume path chosen accordingly.
ALTER TABLE sessions ADD COLUMN external_id TEXT;
ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'agentdeck';

-- One local row per (provider, external session). Partial so the many rows with
-- no external id do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_external
    ON sessions(agent, external_id)
    WHERE external_id IS NOT NULL;
