-- AI 调用记录的请求来源字段。仅在 AI 审计配置开启时写入。
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
