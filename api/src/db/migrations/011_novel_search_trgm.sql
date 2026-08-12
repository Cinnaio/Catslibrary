-- ============================================================
-- 011_novel_search_trgm.sql — 小说搜索 trigram 索引
-- /api/novels 的公开搜索是三列 %LIKE%，普通 btree 索引无法加速，
-- 藏书量大后会全表扫描。pg_trgm 的 GIN 索引可直接服务 LIKE '%x%'。
-- 托管 PG 可能无权限装扩展：装不上时记 NOTICE 跳过索引，功能不受影响。
-- ============================================================
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm 扩展不可用，跳过 trigram 索引: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_novels_title_trgm ON novels USING GIN (title gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_novels_author_trgm ON novels USING GIN (author gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_novels_description_trgm ON novels USING GIN (description gin_trgm_ops);
  END IF;
END $$;
