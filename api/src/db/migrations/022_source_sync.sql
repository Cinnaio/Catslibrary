-- 原作者源站同步：与正文抓取来源分离，只保存元数据、目录标题和映射关系。
CREATE TABLE IF NOT EXISTS novel_source_bindings (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  site             TEXT NOT NULL DEFAULT '',
  source_url       TEXT NOT NULL,
  source_book_id   TEXT NOT NULL DEFAULT '',
  source_type      TEXT NOT NULL DEFAULT 'canonical',
  is_primary       INTEGER NOT NULL DEFAULT 1,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  last_synced_at   BIGINT NOT NULL DEFAULT 0,
  last_error       TEXT NOT NULL DEFAULT '',
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL,
  UNIQUE (novel_id, source_url)
);
CREATE INDEX IF NOT EXISTS idx_novel_source_bindings_novel ON novel_source_bindings(novel_id);
CREATE INDEX IF NOT EXISTS idx_novel_source_bindings_primary ON novel_source_bindings(novel_id, is_primary);

CREATE TABLE IF NOT EXISTS source_sync_runs (
  id                    TEXT PRIMARY KEY,
  binding_id            TEXT NOT NULL REFERENCES novel_source_bindings(id) ON DELETE CASCADE,
  novel_id              TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'preview',
  only_weak_titles      INTEGER NOT NULL DEFAULT 1,
  metadata_json         TEXT NOT NULL DEFAULT '{}',
  source_chapters_json  TEXT NOT NULL DEFAULT '[]',
  changes_json          TEXT NOT NULL DEFAULT '[]',
  mapping_json          TEXT NOT NULL DEFAULT '[]',
  local_snapshot_json   TEXT NOT NULL DEFAULT '[]',
  created_at            BIGINT NOT NULL,
  applied_at            BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_source_sync_runs_novel ON source_sync_runs(novel_id, created_at);

CREATE TABLE IF NOT EXISTS source_chapter_mappings (
  id                    TEXT PRIMARY KEY,
  binding_id            TEXT NOT NULL REFERENCES novel_source_bindings(id) ON DELETE CASCADE,
  sync_run_id           TEXT NOT NULL REFERENCES source_sync_runs(id) ON DELETE CASCADE,
  source_chapter_key    TEXT NOT NULL,
  source_order          INTEGER NOT NULL,
  source_title          TEXT NOT NULL DEFAULT '',
  source_url            TEXT NOT NULL DEFAULT '',
  local_chapter_id      TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  relation              TEXT NOT NULL DEFAULT 'one_to_one',
  part_index            INTEGER NOT NULL DEFAULT 1,
  part_count            INTEGER NOT NULL DEFAULT 1,
  confidence            TEXT NOT NULL DEFAULT 'low',
  created_at            BIGINT NOT NULL,
  UNIQUE (sync_run_id, source_chapter_key, local_chapter_id)
);
CREATE INDEX IF NOT EXISTS idx_source_chapter_mappings_local ON source_chapter_mappings(local_chapter_id);
CREATE INDEX IF NOT EXISTS idx_source_chapter_mappings_source ON source_chapter_mappings(binding_id, source_chapter_key);
