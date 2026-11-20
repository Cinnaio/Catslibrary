-- Branches are immutable alternatives within one author's conversation.
CREATE TABLE ai_agent_plan_branches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  plan JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('saved', 'switch')),
  created_at BIGINT NOT NULL,
  UNIQUE(session_id, name)
);
CREATE INDEX ai_agent_plan_branches_session ON ai_agent_plan_branches(session_id, created_at DESC);

-- Keep receipts after a branch is removed so retries cannot recreate or reapply it.
CREATE TABLE ai_agent_plan_branch_operations (
  session_id TEXT NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  branch_id TEXT NOT NULL,
  applied_revision INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(session_id, request_id)
);
