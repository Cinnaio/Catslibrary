-- 管理员人工画像校正：与自动提取画像分层保存，绑定自动画像来源版本。
CREATE TABLE IF NOT EXISTS novel_ai_profile_overrides (
  novel_id              TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('style', 'plot', 'relationship')),
  content               TEXT NOT NULL DEFAULT '',
  source_json           TEXT NOT NULL DEFAULT '',
  revision              BIGINT NOT NULL DEFAULT 1,
  base_profile_revision TEXT NOT NULL DEFAULT '',
  updated_by            TEXT NOT NULL DEFAULT '',
  updated_at            BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (novel_id, kind)
);

CREATE INDEX IF NOT EXISTS novel_ai_profile_overrides_updated_idx
  ON novel_ai_profile_overrides (updated_at DESC, novel_id, kind);
