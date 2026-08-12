-- Login audit events. Passwords and authentication tokens are never stored.
CREATE TABLE IF NOT EXISTS login_audit (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT '',
  username    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  ip_address  TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_username ON login_audit(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_status ON login_audit(status, created_at DESC);
