-- Reuse is scoped to a book, frozen source versions and generation settings.
ALTER TABLE novel_analysis_reports ADD COLUMN generation_key TEXT NOT NULL DEFAULT '';
ALTER TABLE novel_analysis_reports ADD COLUMN reuse_key TEXT NOT NULL DEFAULT '';
ALTER TABLE novel_analysis_reports ADD COLUMN force_refresh BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE novel_analysis_reports ADD COLUMN reused_sources INTEGER NOT NULL DEFAULT 0;
CREATE INDEX novel_analysis_reports_reuse ON novel_analysis_reports(novel_id, reuse_key, created_at DESC) WHERE reuse_key <> '';

-- Every submission retains its identity even when it attaches to an existing report.
CREATE TABLE novel_analysis_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES novel_analysis_reports(id) ON DELETE CASCADE,
  force_refresh BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, request_id)
);
INSERT INTO novel_analysis_requests(user_id, request_id, report_id)
SELECT user_id, request_id, id FROM novel_analysis_reports;

-- Only neutral, complete reading notes enter this cache; legacy notes stay private to their report.
CREATE TABLE novel_analysis_readings (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  generation_key TEXT NOT NULL,
  group_key TEXT NOT NULL,
  source_keys TEXT[] NOT NULL,
  source_ids TEXT[] NOT NULL,
  content TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (novel_id, generation_key, group_key),
  CHECK (cardinality(source_keys) > 0 AND cardinality(source_keys) = cardinality(source_ids))
);
