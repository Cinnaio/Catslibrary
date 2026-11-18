CREATE TABLE ai_agent_book_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  brief TEXT NOT NULL,
  content_preferences JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, novel_id)
);

-- Legacy sessions tracked activity, not when settings were edited. Seed from the
-- most recently active session with a non-default configuration for each account/book.
INSERT INTO ai_agent_book_settings (user_id, novel_id, brief, content_preferences)
SELECT DISTINCT ON (user_id, novel_id) user_id, novel_id, brief, content_preferences
FROM ai_agent_sessions
WHERE btrim(brief) <> '' OR content_preferences->>'adultContentMode' = 'explicit'
ORDER BY user_id, novel_id, updated_at DESC, created_at DESC, id;
