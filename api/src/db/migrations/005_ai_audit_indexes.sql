-- ============================================================
-- 005_ai_audit_indexes.sql — AI 审计查询性能优化索引
-- 为审计面板的筛选查询添加复合索引
-- ============================================================

-- 用户 + 类型 + 时间：支持按用户筛选特定类型的调用记录
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_type_time
  ON ai_usage(user_id, generation_type, created_at DESC);

-- 类型 + 时间：支持按类型筛选所有用户的调用记录
CREATE INDEX IF NOT EXISTS idx_ai_usage_type_time
  ON ai_usage(generation_type, created_at DESC);

-- 小说 ID：支持查询特定小说的 AI 调用
CREATE INDEX IF NOT EXISTS idx_ai_usage_novel
  ON ai_usage(novel_id);

-- 章节 ID：支持查询特定章节的 AI 调用
CREATE INDEX IF NOT EXISTS idx_ai_usage_chapter
  ON ai_usage(chapter_id);
