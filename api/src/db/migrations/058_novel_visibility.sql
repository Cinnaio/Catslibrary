-- Visibility is independent of content rating. Existing novels remain public.
ALTER TABLE novels ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'admin', 'selected'));
ALTER TABLE novels ADD COLUMN visibility_revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_novels_visibility ON novels (visibility);
CREATE TABLE novel_access_grants (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (novel_id, user_id)
);
CREATE INDEX idx_novel_access_grants_user ON novel_access_grants(user_id, novel_id);
CREATE TABLE novel_visibility_audit (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  previous_visibility TEXT NOT NULL,
  visibility TEXT NOT NULL,
  previous_user_ids JSONB NOT NULL,
  user_ids JSONB NOT NULL,
  revision INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_novel_visibility_audit_novel ON novel_visibility_audit(novel_id, created_at DESC);
