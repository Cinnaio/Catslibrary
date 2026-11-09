-- Additive only. No model calls, existing writing data or story archives are changed.
CREATE TABLE ai_agent_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新的创作对话',
  after_chapter_id TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  content_preferences JSONB NOT NULL DEFAULT '{}',
  active_task_id TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX ai_agent_sessions_owner ON ai_agent_sessions(user_id, novel_id, updated_at DESC);

CREATE TABLE ai_agent_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'activity')),
  content TEXT NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  UNIQUE(session_id, request_id)
);
CREATE INDEX ai_agent_events_session ON ai_agent_events(session_id, id);

CREATE TABLE ai_agent_artifacts (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE INDEX ai_agent_artifacts_session ON ai_agent_artifacts(session_id, created_at DESC);

-- Payload/preview are immutable server-built snapshots. Confirmation accepts only an ID.
CREATE TABLE ai_agent_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('apply_rewrite','publish_draft','adopt_cover','restore_draft')),
  title TEXT NOT NULL,
  payload JSONB NOT NULL,
  preview JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','completed','rejected','failed')),
  result JSONB NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  lease_until BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX ai_agent_actions_session ON ai_agent_actions(session_id, created_at DESC);
