-- ============================================================
-- 004_ai_audit.sql — AI 服务审计字段扩展
-- 新增 IP、UA、关联小说/章节等审计信息，支持管理后台详细审计
-- ============================================================

-- 为 ai_generations 表新增审计字段
ALTER TABLE ai_generations ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_generations ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';

-- 为 ai_usage 表新增关联字段（用于审计时关联具体内容）
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS novel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS chapter_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS generation_type TEXT NOT NULL DEFAULT '';

-- 优化审计查询性能的索引
CREATE INDEX IF NOT EXISTS idx_ai_usage_type ON ai_usage(generation_type, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_type ON ai_usage(user_id, generation_type, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_generations_chapter ON ai_generations(chapter_id);
