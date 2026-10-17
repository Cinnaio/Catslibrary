CREATE TABLE IF NOT EXISTS supplementary_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_hours INTEGER NOT NULL DEFAULT 6 CHECK (interval_hours BETWEEN 1 AND 168),
  checked_at BIGINT NOT NULL DEFAULT 0,
  next_check_at BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'never' CHECK (status IN ('never','ok','partial','error')),
  error TEXT NOT NULL DEFAULT '',
  files_json TEXT NOT NULL DEFAULT '[]',
  checking_until BIGINT NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS supplementary_bindings (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES supplementary_sources(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  alias_title TEXT NOT NULL,
  alias_author TEXT NOT NULL DEFAULT '',
  UNIQUE(source_id,novel_id,alias_title,alias_author)
);
CREATE INDEX IF NOT EXISTS idx_supplementary_bindings_novel ON supplementary_bindings(novel_id);
ALTER TABLE book_import_runs ADD COLUMN IF NOT EXISTS supplementary_binding_id TEXT NOT NULL DEFAULT '';
ALTER TABLE book_import_runs ADD COLUMN IF NOT EXISTS supplementary_file_key TEXT NOT NULL DEFAULT '';
