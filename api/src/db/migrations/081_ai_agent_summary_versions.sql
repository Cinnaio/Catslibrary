-- Preserve future compactions for source-by-source review. Historical versions
-- cannot be reconstructed; only the checkpoint present at migration is backfilled.
CREATE TABLE ai_agent_summary_versions (
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  through_event_id BIGINT NOT NULL,
  content JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  backfilled BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (session_id, revision)
);

INSERT INTO ai_agent_summary_versions(session_id,revision,through_event_id,content,created_at,backfilled)
SELECT session_id,revision,through_event_id,content,updated_at,TRUE FROM ai_agent_summaries;

-- Failed output is retained for private audit, never injected as valid context.
CREATE TABLE ai_agent_summary_failures (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL DEFAULT '',
  diagnostic JSONB NOT NULL,
  response_received BOOLEAN NOT NULL,
  response_text TEXT NOT NULL DEFAULT '',
  response_model TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX ai_agent_summary_failures_session ON ai_agent_summary_failures(session_id,id);
