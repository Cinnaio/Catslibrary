-- AI 生成产物软删除：管理端删除后 10 秒内可撤销，超时记录由后续删除/恢复顺带物理清理。
-- deleted_at = 0 表示未删除；非 0 为删除时间戳（毫秒）。
ALTER TABLE ai_generations ADD COLUMN deleted_at BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ai_generations_deleted ON ai_generations(deleted_at);
