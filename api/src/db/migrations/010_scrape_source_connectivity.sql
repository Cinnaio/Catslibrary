-- 书源站点连接检测结果。
-- 原为 006，与 006_ai_usage_request_audit 版本号冲突导致全新安装迁移失败，重编号为 010。
-- 幂等执行：历史库可能已以版本 6 记账并实际建过这些列。
ALTER TABLE scrape_sources ADD COLUMN IF NOT EXISTS connectivity TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE scrape_sources ADD COLUMN IF NOT EXISTS connectivity_checked_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE scrape_sources ADD COLUMN IF NOT EXISTS connectivity_error TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_scrape_sources_connectivity ON scrape_sources(connectivity);
