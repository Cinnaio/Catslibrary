CREATE TABLE ai_agent_outlines (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  chapters JSONB NOT NULL,
  PRIMARY KEY (user_id, novel_id)
);
