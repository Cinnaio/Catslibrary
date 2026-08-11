-- ============================================================
-- 003_ai_cache.sql — AI 产物缓存查询索引
-- routes/ai.ts 的提要命中路径是 (kind, chapter_id, status)，
-- 002 里只有 (novel_id, created_at) 与 (status, created_at)，命中查询会退化成扫描。
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ai_generations_cache
  ON ai_generations(kind, chapter_id, status);
