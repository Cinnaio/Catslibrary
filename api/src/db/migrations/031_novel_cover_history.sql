-- 管理员替换封面时保留可恢复的本地快照；爬虫/懒缓存写入不进入此表。
ALTER TABLE novel_covers ADD COLUMN IF NOT EXISTS prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE novel_covers ADD COLUMN IF NOT EXISTS metadata TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS novel_cover_history (
  id           TEXT PRIMARY KEY,
  novel_id     TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  data         BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  source       TEXT NOT NULL DEFAULT '',
  prompt       TEXT NOT NULL DEFAULT '',
  metadata     TEXT NOT NULL DEFAULT '',
  image_hash   TEXT NOT NULL DEFAULT '',
  created_at   BIGINT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  actor_id     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_novel_cover_history_novel_created
  ON novel_cover_history(novel_id, created_at DESC, id DESC);
