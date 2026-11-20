CREATE TABLE ai_agent_writing_references (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  content TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX ai_agent_writing_references_owner ON ai_agent_writing_references(user_id, updated_at DESC, id) WHERE deleted_at=0;
ALTER TABLE ai_agent_sessions ADD COLUMN writing_reference_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
