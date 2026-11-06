-- 旧站不猜测创始人。迁移后通过 admin:recover 明确指定已有账号。
CREATE TABLE site_initialization (
  id TEXT PRIMARY KEY CHECK (id = 'site'),
  initialized_at BIGINT NOT NULL
);
INSERT INTO site_initialization (id, initialized_at)
SELECT 'site', (extract(epoch FROM now()) * 1000)::bigint WHERE EXISTS (SELECT 1 FROM users);

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('reader', 'admin', 'super_admin'));
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE account_email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
  email TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX account_email_tokens_user ON account_email_tokens(user_id, purpose);

CREATE TABLE account_security_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX account_security_audit_time ON account_security_audit(created_at DESC);
