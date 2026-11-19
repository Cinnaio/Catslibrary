-- Published chapter edits remain recoverable after deleting an Agent conversation/task.
ALTER TABLE ai_agent_actions DROP CONSTRAINT ai_agent_actions_kind_check;
ALTER TABLE ai_agent_actions ADD CONSTRAINT ai_agent_actions_kind_check CHECK
  (kind IN ('apply_rewrite','publish_draft','adopt_cover','restore_draft','apply_chapter_edit','restore_chapter'));

CREATE TABLE ai_chapter_edit_history (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('apply_chapter_edit','restore_chapter')),
  chapter_title TEXT NOT NULL,
  before_content TEXT NOT NULL,
  after_content TEXT NOT NULL,
  before_revision TEXT NOT NULL,
  after_revision TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX ai_chapter_edit_history_chapter ON ai_chapter_edit_history(chapter_id, created_at DESC, id DESC);
