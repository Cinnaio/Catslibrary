-- 书源站点连接检测结果
ALTER TABLE scrape_sources ADD COLUMN connectivity TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE scrape_sources ADD COLUMN connectivity_checked_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE scrape_sources ADD COLUMN connectivity_error TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_scrape_sources_connectivity ON scrape_sources(connectivity);
