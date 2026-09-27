-- 书籍导入：保存预览快照与实际变更，支持增量导入后的安全撤回。
-- payload/preview/changes 使用 JSON 文本，避免把文件/URL 的解析细节散落到多张表。
CREATE TABLE IF NOT EXISTS book_import_runs (
  id               TEXT PRIMARY KEY,
  actor_user_id    TEXT NOT NULL DEFAULT '',
  source_type      TEXT NOT NULL DEFAULT 'file' CHECK (source_type IN ('file', 'url')),
  source_label     TEXT NOT NULL DEFAULT '',
  source_url       TEXT NOT NULL DEFAULT '',
  target_novel_id  TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'applied', 'rolled_back', 'partial')),
  payload_json     TEXT NOT NULL DEFAULT '{}',
  preview_json     TEXT NOT NULL DEFAULT '{}',
  changes_json     TEXT NOT NULL DEFAULT '[]',
  created_at       BIGINT NOT NULL,
  applied_at       BIGINT NOT NULL DEFAULT 0,
  rolled_back_at   BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_book_import_runs_created
  ON book_import_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_book_import_runs_novel_created
  ON book_import_runs(target_novel_id, created_at DESC);
