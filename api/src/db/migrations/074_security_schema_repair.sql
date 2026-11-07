-- Some development databases recorded 072 before these columns were added to
-- that file. Repair those installations without replaying or changing 072.
-- Unattributed historical events stay visible only to super administrators.
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS target_id text NOT NULL DEFAULT '';

-- The earlier queue reserved its budget at creation time. Preserve the period
-- for old jobs, while retaining any budget rollover already stored by new code.
ALTER TABLE mail_jobs ADD COLUMN IF NOT EXISTS budget_at bigint;
UPDATE mail_jobs SET budget_at=created_at WHERE budget_at IS NULL;
ALTER TABLE mail_jobs ALTER COLUMN budget_at SET NOT NULL;

-- Preserve uncertain sends across retries. Missing attempt history is treated
-- conservatively; existing explicit flags from the current schema are unchanged.
ALTER TABLE mail_jobs ADD COLUMN IF NOT EXISTS had_unknown boolean;
UPDATE mail_jobs j SET had_unknown=(
  j.state IN ('sending','unknown')
  OR EXISTS(SELECT 1 FROM mail_attempts a WHERE a.job_id=j.id AND a.outcome IN ('sending','unknown'))
  OR (j.attempts>0 AND NOT EXISTS(SELECT 1 FROM mail_attempts a WHERE a.job_id=j.id))
) WHERE j.had_unknown IS NULL;
ALTER TABLE mail_jobs ALTER COLUMN had_unknown SET DEFAULT false;
ALTER TABLE mail_jobs ALTER COLUMN had_unknown SET NOT NULL;
