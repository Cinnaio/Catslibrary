-- Stable outline chapter identities survive edits and ordering changes.
UPDATE ai_agent_outlines o SET chapters = (
  SELECT jsonb_agg(item || jsonb_build_object('id', 'olc_' || md5(o.user_id || ':' || o.novel_id || ':' || ordinal::text)) ORDER BY ordinal)
  FROM jsonb_array_elements(o.chapters) WITH ORDINALITY AS entry(item, ordinal)
);
ALTER TABLE ai_agent_outlines ADD COLUMN operation_id TEXT NOT NULL DEFAULT '';
CREATE TABLE ai_agent_story_thread_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  source_anchor_id TEXT NOT NULL,
  thread JSONB NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('advance','later','hold','resolved')),
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ai_agent_story_thread_source ON ai_agent_story_thread_plans(user_id, novel_id, source_revision, (thread->>'id'));
