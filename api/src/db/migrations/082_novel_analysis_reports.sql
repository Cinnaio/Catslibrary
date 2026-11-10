-- Independent, reviewable reports. Never promoted to writing memory by this table.
CREATE TABLE novel_analysis_reports (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_json JSONB NOT NULL,
  source_json JSONB NOT NULL,
  notes_json JSONB NOT NULL DEFAULT '[]',
  synthesis_json JSONB,
  checked_source_ids JSONB NOT NULL DEFAULT '[]',
  content TEXT NOT NULL DEFAULT '',
  edited_content TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  task_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (user_id, request_id)
);
CREATE INDEX novel_analysis_reports_novel ON novel_analysis_reports(novel_id, created_at DESC, id DESC);
