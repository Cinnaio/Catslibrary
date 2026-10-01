-- 保留 NULL：历史数据或未回传字段不能视作未命中缓存。
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER CHECK (cache_read_tokens >= 0);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER CHECK (cache_write_tokens >= 0);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER CHECK (reasoning_tokens >= 0);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cost_reported BOOLEAN NOT NULL DEFAULT FALSE;
-- 旧的非零金额已由上游回传；旧的零金额无法区分免费和缺失。
UPDATE ai_usage SET cost_reported = TRUE WHERE cost_millicents > 0;
