-- Attribute newly recorded calls to their coordinating turn. Historical usage is
-- deliberately not guessed from timestamps; non-Agent callers remain unlinked.
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS task_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS token_usage_reported BOOLEAN;
CREATE INDEX IF NOT EXISTS idx_ai_usage_task_user ON ai_usage(task_id, user_id) WHERE task_id <> '';
