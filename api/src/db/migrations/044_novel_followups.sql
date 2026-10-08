CREATE TABLE novel_followups (
  novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_hours INTEGER NOT NULL DEFAULT 6 CHECK (interval_hours IN (1,3,6,12,24)),
  next_check_at BIGINT NOT NULL DEFAULT 0,
  checked_at BIGINT NOT NULL DEFAULT 0,
  last_job_id TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'idle',
  message TEXT NOT NULL DEFAULT '',
  added_count INTEGER NOT NULL DEFAULT 0,
  empty_checks INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_novel_followups_due ON novel_followups(next_check_at) WHERE enabled;
