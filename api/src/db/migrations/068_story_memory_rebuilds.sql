CREATE TABLE IF NOT EXISTS novel_story_memory_snapshots (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('plot','relationship')),
  role TEXT NOT NULL CHECK (role IN ('checkpoint','archive')),
  content TEXT NOT NULL,
  source_json TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  reusable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS story_memory_snapshots_lookup ON novel_story_memory_snapshots(novel_id, kind, created_at DESC);
CREATE TABLE IF NOT EXISTS novel_story_memory_rebuilds (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('plot','relationship')),
  revision TEXT NOT NULL,
  pending BOOLEAN NOT NULL DEFAULT TRUE,
  from_chapter_id TEXT NOT NULL,
  target_chapter_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (novel_id, kind)
);
