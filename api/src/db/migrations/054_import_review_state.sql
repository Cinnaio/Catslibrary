ALTER TABLE book_import_runs DROP CONSTRAINT book_import_runs_status_check;
ALTER TABLE book_import_runs ADD CONSTRAINT book_import_runs_status_check CHECK (status IN ('preview','applied','partial','rolled_back','expired'));
-- 快照版本、复核租约与轻量历史摘要。原文保留：预览 7 天，完成后 30 天。
ALTER TABLE book_import_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE book_import_runs ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE book_import_runs ADD COLUMN source_expires_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE book_import_runs ADD COLUMN review_token TEXT NOT NULL DEFAULT '';
ALTER TABLE book_import_runs ADD COLUMN review_started_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE book_import_runs ADD COLUMN history_summary TEXT NOT NULL DEFAULT '{}';
UPDATE book_import_runs SET
 source_expires_at = CASE WHEN status='preview' THEN created_at + 604800000 ELSE GREATEST(created_at, applied_at) + 2592000000 END,
 history_summary = jsonb_build_object(
  'title', COALESCE(preview_json::jsonb #>> '{book,title}', ''),
  'conflicts', COALESCE((preview_json::jsonb #>> '{summary,conflictCount}')::integer, 0),
  'created', (SELECT count(*) FROM jsonb_array_elements(changes_json::jsonb) x WHERE x->>'kind'='create-chapter'),
  'updated', (SELECT count(*) FROM jsonb_array_elements(changes_json::jsonb) x WHERE x->>'kind'='update-chapter')
 )::text;
CREATE INDEX idx_book_import_expiry ON book_import_runs(source_expires_at) WHERE source_expires_at > 0;
CREATE TABLE book_import_review_attempts (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES book_import_runs(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'running',
 error TEXT NOT NULL DEFAULT '',
 model TEXT NOT NULL DEFAULT '',
 created_at BIGINT NOT NULL,
 completed_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_import_review_attempt_created ON book_import_review_attempts(created_at);
