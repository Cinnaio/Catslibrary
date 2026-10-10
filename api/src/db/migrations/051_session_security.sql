ALTER TABLE user_sessions ADD COLUMN last_seen_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_sessions ADD COLUMN reauthenticated_at BIGINT NOT NULL DEFAULT 0;
UPDATE user_sessions SET last_seen_at=created_at;
