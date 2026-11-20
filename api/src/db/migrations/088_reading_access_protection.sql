-- 只记录经过访问授权的正文；身份和资源均使用带盐摘要，不保存正文或原始 IP。
CREATE TABLE IF NOT EXISTS reading_access_windows (
  subject_hash TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('account', 'guest', 'ip')),
  window_minutes INTEGER NOT NULL CHECK (window_minutes IN (10, 60, 1440)),
  window_start BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  unique_chapters INTEGER NOT NULL DEFAULT 0,
  unique_novels INTEGER NOT NULL DEFAULT 0,
  limited_count INTEGER NOT NULL DEFAULT 0,
  flagged_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_hash, window_minutes, window_start)
);
CREATE INDEX IF NOT EXISTS reading_access_windows_expiry ON reading_access_windows(expires_at);
CREATE INDEX IF NOT EXISTS reading_access_windows_summary ON reading_access_windows(window_minutes, window_start, subject_kind);
CREATE TABLE IF NOT EXISTS reading_access_items (
  subject_hash TEXT NOT NULL,
  window_minutes INTEGER NOT NULL,
  window_start BIGINT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('chapter', 'novel')),
  item_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (subject_hash, window_minutes, window_start, item_kind, item_hash)
);
CREATE INDEX IF NOT EXISTS reading_access_items_expiry ON reading_access_items(expires_at);
