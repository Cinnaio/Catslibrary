-- AI 发布来源追踪。
-- source_url 继续保留给抓取章节的原始链接；AI 发布使用独立字段，避免把任务 ID
-- 塞进 URL 或丢失在 ai_generations 状态变更之后。
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS ai_task_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_chapters_ai_task_id ON chapters(ai_task_id);
