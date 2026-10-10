-- Independent reading facts: progress repair/restoration must not change these records.
CREATE TABLE reading_stat_events (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  content_rating TEXT NOT NULL DEFAULT 'unknown' CHECK (content_rating IN ('general','restricted','unknown')),
  chapter_id TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  CHECK (ended_at > started_at AND ended_at - started_at <= 35000)
);
CREATE INDEX reading_stat_events_user_time ON reading_stat_events(user_id, started_at, ended_at);
CREATE INDEX reading_stat_events_user_session ON reading_stat_events(user_id, session_id);
