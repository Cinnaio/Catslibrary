-- 管理员副作用操作审计：只保留操作元数据与请求哈希，不保存原始目标内容。
CREATE TABLE IF NOT EXISTS admin_operation_audit (
  id                    TEXT PRIMARY KEY,
  operation_id          TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  actor_user_id         TEXT NOT NULL,
  action                TEXT NOT NULL,
  target_count          INTEGER NOT NULL DEFAULT 0,
  request_hash          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  response_status       INTEGER NOT NULL DEFAULT 202,
  replay_count          INTEGER NOT NULL DEFAULT 0,
  error                 TEXT NOT NULL DEFAULT '',
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL,
  finished_at           BIGINT NOT NULL DEFAULT 0,
  UNIQUE (scope, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_operation_audit_created
  ON admin_operation_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_operation_audit_status_created
  ON admin_operation_audit(status, created_at DESC);
