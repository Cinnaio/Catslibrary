-- 修复部分环境中 006 已记账但字段未实际创建的问题。
-- 幂等执行，确保旧数据库升级后审计查询可用。
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '';
