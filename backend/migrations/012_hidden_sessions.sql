-- Hide harness-created sessions from the workspace lists.
--
-- Orchestration children and room channels are real session rows (they have
-- transcripts, config, cost) but they are not user-created tasks: they belong
-- to the run or room that spawned them and are surfaced in the room/agent
-- views instead. `hidden = 1` keeps them out of the default lists while every
-- by-id lookup — transcript, resume, kill — keeps working.

ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
