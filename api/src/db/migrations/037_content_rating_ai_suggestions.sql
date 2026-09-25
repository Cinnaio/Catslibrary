-- 内容分级 P3：LLM 只生成待审核建议，不直接修改作品分级。
--
-- 每条建议保存输入快照、模型、提示词版本、置信度、理由和证据。
-- novel_rating_revision 用于防止作品在模型调用期间发生变化后，旧建议仍被采纳。

CREATE TABLE IF NOT EXISTS content_rating_ai_suggestions (
  id                     TEXT PRIMARY KEY,
  novel_id               TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  task_id                TEXT NOT NULL DEFAULT '',
  novel_rating_revision  INTEGER NOT NULL DEFAULT 0 CHECK (novel_rating_revision >= 0),
  input_snapshot         TEXT NOT NULL DEFAULT '{}',
  suggested_rating       TEXT NOT NULL DEFAULT 'unknown' CHECK (suggested_rating IN ('restricted', 'unknown')),
  confidence             NUMERIC NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  reason                 TEXT NOT NULL DEFAULT '',
  evidence               TEXT NOT NULL DEFAULT '[]',
  model                  TEXT NOT NULL DEFAULT '',
  prompt_version         TEXT NOT NULL DEFAULT 'content-rating-ai-v1',
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'stale', 'failed')),
  review_revision        INTEGER NOT NULL DEFAULT 0 CHECK (review_revision >= 0),
  reviewed_by            TEXT NOT NULL DEFAULT '',
  reviewed_at            BIGINT NOT NULL DEFAULT 0,
  review_reason          TEXT NOT NULL DEFAULT '',
  error                  TEXT NOT NULL DEFAULT '',
  created_at             BIGINT NOT NULL,
  updated_at             BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_rating_ai_suggestions_task_novel
  ON content_rating_ai_suggestions(task_id, novel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_rating_ai_suggestions_pending_novel_revision
  ON content_rating_ai_suggestions(novel_id, novel_rating_revision)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_content_rating_ai_suggestions_status_updated
  ON content_rating_ai_suggestions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_rating_ai_suggestions_novel_created
  ON content_rating_ai_suggestions(novel_id, created_at DESC);
