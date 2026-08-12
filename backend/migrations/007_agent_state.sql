-- Agent state history: an append-only per-session log of status
-- transitions. The status submisser records a row here each time a session
-- changes state (running, waiting_for_input, waiting_for_approval, exited…)
-- so the desktop can reconstruct timelines, diagnose wedged agents, and show
-- "what happened and when" without duplicating the mutable `sessions.status`.
CREATE TABLE IF NOT EXISTS agent_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    source TEXT NOT NULL DEFAULT 'session_manager',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_state_session ON agent_state(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_state_status ON agent_state(status);