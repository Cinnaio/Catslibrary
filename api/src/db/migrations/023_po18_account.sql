-- PO18.tw 登录凭证与会话：密码和 Cookie 均使用应用密钥加密保存，不向前端回传。
CREATE TABLE IF NOT EXISTS source_accounts (
  id                       TEXT PRIMARY KEY,
  site                     TEXT NOT NULL UNIQUE,
  username                 TEXT NOT NULL DEFAULT '',
  password_ciphertext      TEXT NOT NULL DEFAULT '',
  password_iv              TEXT NOT NULL DEFAULT '',
  password_tag             TEXT NOT NULL DEFAULT '',
  session_ciphertext       TEXT NOT NULL DEFAULT '',
  session_iv               TEXT NOT NULL DEFAULT '',
  session_tag               TEXT NOT NULL DEFAULT '',
  status                   TEXT NOT NULL DEFAULT 'not_configured',
  last_login_at            BIGINT NOT NULL DEFAULT 0,
  last_checked_at          BIGINT NOT NULL DEFAULT 0,
  last_error               TEXT NOT NULL DEFAULT '',
  created_at               BIGINT NOT NULL,
  updated_at               BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_accounts_site ON source_accounts(site);
