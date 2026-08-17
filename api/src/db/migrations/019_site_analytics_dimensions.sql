-- 匿名访问仅记录经过归类的维度，不保存 IP、完整 User-Agent 或来源地址。
ALTER TABLE site_visits ADD COLUMN country_code TEXT NOT NULL DEFAULT 'ZZ';
ALTER TABLE site_visits ADD COLUMN device_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE site_visits ADD COLUMN referrer_type TEXT NOT NULL DEFAULT 'direct';

CREATE INDEX idx_site_visits_country_time ON site_visits(country_code, visited_at DESC);
CREATE INDEX idx_site_visits_device_time ON site_visits(device_type, visited_at DESC);
CREATE INDEX idx_site_visits_referrer_time ON site_visits(referrer_type, visited_at DESC);
