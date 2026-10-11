-- 源站融合：人工映射版本、实际应用审计与安全撤回。
ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS manual_mappings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS applied_changes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS history_summary TEXT NOT NULL DEFAULT '{}';
ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS rollback_result_json TEXT NOT NULL DEFAULT '';
ALTER TABLE source_sync_runs ADD COLUMN IF NOT EXISTS rolled_back_at BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_source_sync_runs_history ON source_sync_runs(novel_id, applied_at DESC, id DESC);
