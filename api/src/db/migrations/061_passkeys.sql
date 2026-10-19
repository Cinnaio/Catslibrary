-- Passkey / WebAuthn credentials and one-time challenges.
-- Private keys never leave the authenticator and are never stored here.
CREATE TABLE IF NOT EXISTS user_passkeys (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   TEXT NOT NULL,
  public_key      TEXT NOT NULL,
  user_handle     TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  sign_count      BIGINT NOT NULL DEFAULT 0,
  transports      TEXT NOT NULL DEFAULT '[]',
  backup_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  backup_state    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      BIGINT NOT NULL,
  last_used_at    BIGINT NOT NULL DEFAULT 0,
  last_user_agent TEXT NOT NULL DEFAULT '',
  revoked_at      BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_passkeys_active_credential ON user_passkeys(credential_id) WHERE revoked_at = 0;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL DEFAULT '',
  session_hash TEXT NOT NULL DEFAULT '',
  purpose      TEXT NOT NULL,
  challenge    TEXT NOT NULL UNIQUE,
  expires_at   BIGINT NOT NULL,
  created_at   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
  ON webauthn_challenges(purpose, user_id, session_hash, expires_at);

ALTER TABLE login_audit
  ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS passkey_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_login_audit_auth_method ON login_audit(auth_method, created_at DESC);
