-- R18 授权只能来自经过 Turnstile 的有效登录会话；历史会话默认未授权。
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS adult_access_until BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS content_request_limits (
  key_hash TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_request_limits_expiry ON content_request_limits(expires_at);
