ALTER TABLE supplementary_bindings
  ADD COLUMN update_mode TEXT NOT NULL DEFAULT 'manual' CHECK (update_mode IN ('manual','preview','append')),
  ADD COLUMN update_scan_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN update_lease_until BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN update_result JSONB;

CREATE UNIQUE INDEX idx_supplementary_one_auto_writer ON supplementary_bindings(novel_id) WHERE update_mode='append';
CREATE INDEX idx_supplementary_updates_due ON supplementary_bindings(source_id,update_scan_at) WHERE update_mode<>'manual';

ALTER TABLE book_import_runs
  ADD COLUMN supplementary_auto_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN supplementary_auto_file_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN supplementary_auto_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_book_import_auto_hash ON book_import_runs(target_novel_id,supplementary_auto_hash) WHERE supplementary_auto_hash<>'';
CREATE INDEX idx_book_import_auto_file ON book_import_runs(supplementary_binding_id,supplementary_auto_file_version) WHERE supplementary_auto_file_version<>'';
