-- AI 封面候选：AI 生成结果先存候选，管理员采纳后才覆盖当前封面（novel_covers）。
-- 这样生成不好看可随时弃用，当前封面永不丢失；也支持一次生成多次候选。
CREATE TABLE IF NOT EXISTS ai_cover_candidates (
  id           TEXT PRIMARY KEY,
  novel_id     TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  data         BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/png',
  prompt       TEXT NOT NULL DEFAULT '',
  task_id      TEXT NOT NULL DEFAULT '',
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_cover_candidates_novel ON ai_cover_candidates(novel_id, created_at DESC);
