-- Resume support: sessions that the CLI can resume (a prior claude session with
-- conversation history) are marked `needs_resume` instead of being left as a
-- dead `exited`. The resume_command column holds the exact command the backend
-- computed so the UI never has to parse terminal text to offer a Resume action.
ALTER TABLE sessions ADD COLUMN resume_command TEXT;
