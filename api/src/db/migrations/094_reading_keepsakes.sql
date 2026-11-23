-- Private keepsakes retain the selected words as they were when saved.
CREATE TABLE reading_keepsakes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  saved_at BIGINT NOT NULL,
  request_hash TEXT NOT NULL,
  snapshot JSONB,
  deleted_at BIGINT,
  CHECK ((deleted_at IS NULL AND snapshot IS NOT NULL) OR (deleted_at IS NOT NULL AND snapshot IS NULL)),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX reading_keepsakes_user_novel_time
  ON reading_keepsakes(user_id, novel_id, saved_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX reading_stat_events_user_novel_time
  ON reading_stat_events(user_id, novel_id, started_at);
