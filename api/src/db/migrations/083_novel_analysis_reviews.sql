-- Separate review attempts preserve the report, generation task and older results.
CREATE TABLE novel_analysis_reviews (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES novel_analysis_reports(id) ON DELETE CASCADE,
  report_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  checker_version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('citation','fact')),
  user_id TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  request_json JSONB NOT NULL DEFAULT '{}',
  task_id TEXT NOT NULL DEFAULT '',
  input_json JSONB NOT NULL DEFAULT '{}',
  result_json JSONB,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX novel_analysis_reviews_request ON novel_analysis_reviews(user_id,request_id) WHERE kind='fact';
CREATE UNIQUE INDEX novel_analysis_reviews_citation ON novel_analysis_reviews
  (report_id,report_revision,content_hash,source_fingerprint,checker_version) WHERE kind='citation';
CREATE INDEX novel_analysis_reviews_report ON novel_analysis_reviews(report_id,created_at DESC,id DESC);
