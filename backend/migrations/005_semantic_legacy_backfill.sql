INSERT OR IGNORE INTO messages (id, session_id, role, content, timestamp)
SELECT 'legacy-' || id, session_id, kind, content, timestamp
FROM transcripts
WHERE kind IN ('user', 'system');

INSERT INTO terminal_output (session_id, sequence, data, timestamp)
SELECT session_id, id, content, timestamp
FROM transcripts
WHERE kind = 'raw';
