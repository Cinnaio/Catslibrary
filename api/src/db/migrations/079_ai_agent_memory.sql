-- Long-term creative agreements are separate from formal story memory and
-- raw conversation events. Summaries are session-scoped and replaceable.
CREATE TABLE ai_agent_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES ai_agent_sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'agreement' CHECK (kind = 'agreement'),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'superseded', 'archived')),
  source_event_id BIGINT REFERENCES ai_agent_events(id) ON DELETE SET NULL,
  supersedes_id TEXT REFERENCES ai_agent_memories(id) ON DELETE SET NULL,
  target_revision INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX ai_agent_memories_scope ON ai_agent_memories(user_id, novel_id, kind, status, updated_at DESC);
CREATE INDEX ai_agent_memories_session ON ai_agent_memories(session_id, kind, updated_at DESC);

CREATE TABLE ai_agent_summaries (
  session_id TEXT PRIMARY KEY REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  through_event_id BIGINT NOT NULL,
  content JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);
