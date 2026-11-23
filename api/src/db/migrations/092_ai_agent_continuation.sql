-- Only author-selected continuation notes are copied into a follow-up session.
ALTER TABLE ai_agent_sessions ADD COLUMN continuation_notes JSONB NOT NULL DEFAULT '[]';
