-- Resumable extraction is separate from the effective archive. Partial builds
-- must never replace the last confirmed archive used by continuation.
CREATE TABLE IF NOT EXISTS novel_story_memory_builds (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('plot', 'relationship')),
  content TEXT NOT NULL DEFAULT '',
  source_json TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (novel_id, kind)
);
