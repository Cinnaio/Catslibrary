-- API 幂等请求记录：同一账号、同一作用域和同一客户端操作 ID 只允许产生一次副作用。
-- response_body 用文本保存 JSON 响应，便于连接断开后重放原始结果。
CREATE TABLE IF NOT EXISTS api_idempotency (
  id                    TEXT PRIMARY KEY,
  scope                 TEXT NOT NULL,
  operation_key         TEXT NOT NULL,
  request_hash          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  response_status       INTEGER NOT NULL DEFAULT 202,
  response_content_type TEXT NOT NULL DEFAULT 'application/json',
  response_body         TEXT NOT NULL DEFAULT '{}',
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL,
  expires_at            BIGINT NOT NULL,
  UNIQUE (scope, operation_key)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_expiry
  ON api_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_updated
  ON api_idempotency(updated_at DESC);
