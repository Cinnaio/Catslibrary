CREATE TABLE IF NOT EXISTS ai_tasks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT '',
  novel_id    TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  current     INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL DEFAULT 1,
  step        TEXT NOT NULL DEFAULT '',
  prompt      TEXT NOT NULL DEFAULT '',
  batch_id    TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  finished_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_updated ON ai_tasks(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_user_created ON ai_tasks(user_id, created_at);
