-- Author-controlled proposals, source-bound evidence and immutable revision history.
CREATE TABLE ai_writing_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scene','voice','reading','knowledge','relationship','preference')),
  scope TEXT NOT NULL CHECK (scope IN ('session','book','personal')),
  status TEXT NOT NULL CHECK (status IN ('proposed','active','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  card JSONB NOT NULL,
  operation_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK ((scope='personal' AND kind='preference' AND novel_id IS NULL AND session_id IS NULL)
    OR (scope='book' AND novel_id IS NOT NULL AND session_id IS NULL AND kind NOT IN ('scene','reading'))
    OR (scope='session' AND novel_id IS NOT NULL AND session_id IS NOT NULL AND kind IN ('scene','reading'))),
  UNIQUE(user_id, operation_id)
);
CREATE INDEX ai_writing_cards_owner ON ai_writing_cards(user_id, novel_id, session_id, status);
CREATE TABLE ai_writing_card_versions (
  card_id TEXT NOT NULL REFERENCES ai_writing_cards(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  card JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (card_id, revision)
);
CREATE TABLE ai_writing_assemblies (
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES ai_generations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY(session_id, fingerprint)
);

-- Explicitly saved manual drafts and accepted rewrites; never rejected suggestions.
CREATE TABLE ai_writing_edit_samples (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES ai_generations(id) ON DELETE CASCADE,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX ai_writing_edit_samples_owner ON ai_writing_edit_samples(user_id,novel_id,created_at DESC);
