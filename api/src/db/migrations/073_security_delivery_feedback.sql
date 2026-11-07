-- Kept separate because the local development server may already have applied 072.
ALTER TABLE security_events ADD COLUMN source_hash text NOT NULL DEFAULT '';
ALTER TABLE mail_delivery_events ADD COLUMN delivery_state text NOT NULL DEFAULT '';
ALTER TABLE mail_delivery_events ADD COLUMN suppress boolean NOT NULL DEFAULT false;
UPDATE mail_delivery_events SET delivery_state=CASE kind
  WHEN 'email.sent' THEN 'accepted'
  WHEN 'email.delivered' THEN 'delivered'
  WHEN 'email.bounced' THEN 'bounced'
  WHEN 'email.complained' THEN 'complained'
  ELSE 'failed' END,
  suppress=kind IN ('email.bounced','email.complained','email.suppressed');
CREATE UNIQUE INDEX mail_attempts_job_attempt ON mail_attempts(job_id,attempt);
