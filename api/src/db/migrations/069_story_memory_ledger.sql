-- Opt-in incremental memory. Original archives and their history remain intact.
CREATE TABLE novel_story_memory_chapters (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  input_revision TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (novel_id, chapter_id)
);
CREATE INDEX story_memory_chapters_order ON novel_story_memory_chapters(novel_id, ordinal);
-- Latest publication waiting behind an already-running, fixed-target task.
CREATE TABLE novel_story_memory_preparations (
  novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
