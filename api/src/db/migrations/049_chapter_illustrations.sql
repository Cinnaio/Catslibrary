-- Immutable assets survive replacement/deletion for undo; chapter deletion cleans them up.
CREATE TABLE chapter_illustration_assets (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  created_at BIGINT NOT NULL
);
CREATE TABLE chapter_illustrations (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES chapter_illustration_assets(id),
  caption TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL CHECK (size IN ('medium', 'full')),
  anchor JSONB NOT NULL,
  chapter_revision TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX chapter_illustrations_chapter_idx ON chapter_illustrations(chapter_id, sort_order);
