CREATE TABLE ai_writing_reviews (
  draft_id TEXT NOT NULL REFERENCES ai_generations(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  draft_revision TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  report_json TEXT NOT NULL DEFAULT '',
  sources_json TEXT NOT NULL DEFAULT '[]',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (draft_id, input_hash)
);
