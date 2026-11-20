-- Keep original evidence and binding changes when a deleted book is imported again.
ALTER TABLE ai_generations ADD COLUMN book_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_generations ADD COLUMN association_history_json JSONB NOT NULL DEFAULT '[]';
ALTER TABLE ai_generations ADD COLUMN association_revision INTEGER NOT NULL DEFAULT 0;

-- Existing books can be snapshotted accurately; missing legacy books remain unknown.
UPDATE ai_generations g SET book_snapshot_json = json_build_object(
  'novelId', g.novel_id, 'title', n.title, 'author', n.author, 'sourceUrl', n.source_url
)::text FROM novels n WHERE n.id = g.novel_id;
