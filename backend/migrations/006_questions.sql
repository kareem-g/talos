CREATE TABLE IF NOT EXISTS questions (
    question_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    selection_mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at DATETIME,
    selected_options TEXT,
    custom_text TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_questions_session_status ON questions(session_id, status);
