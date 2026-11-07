ALTER TABLE ai_tasks ADD COLUMN owner_id text NOT NULL DEFAULT '';
ALTER TABLE ai_tasks ADD COLUMN lease_expires_at bigint NOT NULL DEFAULT 0;
-- A process may execute a task only once, including recovery. Keep prior owners
-- so a delayed callback cannot regain authority after A -> B -> A.
ALTER TABLE ai_tasks ADD COLUMN owner_history text[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_ai_tasks_active_lease ON ai_tasks(lease_expires_at,created_at,id)
  WHERE status IN ('queued','running');
