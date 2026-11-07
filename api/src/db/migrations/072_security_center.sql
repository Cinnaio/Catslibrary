CREATE TABLE security_policy (
  id text PRIMARY KEY CHECK (id = 'site'), value jsonb NOT NULL, updated_at bigint NOT NULL
);
CREATE TABLE security_counters (
  key_hash text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at bigint NOT NULL
);
CREATE INDEX security_counters_expiry ON security_counters(expires_at);
CREATE TABLE security_events (
  id text PRIMARY KEY, bucket text UNIQUE NOT NULL, action text NOT NULL, rule text NOT NULL,
  outcome text NOT NULL, identity_hint text NOT NULL DEFAULT '', target_id text NOT NULL DEFAULT '', count integer NOT NULL DEFAULT 1,
  policy_revision integer NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL
);
CREATE INDEX security_events_time ON security_events(updated_at DESC);
CREATE TABLE security_restrictions (
  id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('account','email','ip')), key_hash text NOT NULL,
  action text NOT NULL, effect text NOT NULL CHECK(effect IN ('block','allow')), hint text NOT NULL,
  reason text NOT NULL, expires_at bigint NOT NULL, created_at bigint NOT NULL, actor_id text NOT NULL
);
CREATE INDEX security_restrictions_lookup ON security_restrictions(key_hash, expires_at);
CREATE TABLE mail_jobs (
  id text PRIMARY KEY, user_id text NOT NULL, actor_id text NOT NULL, recipient_hash text NOT NULL,
  recipient_hint text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('verify-email','reset-password','test')),
  state text NOT NULL CHECK(state IN ('queued','sending','accepted','delivered','failed','unknown','expired','cancelled','bounced','complained')),
  emergency boolean NOT NULL DEFAULT false, payload text NOT NULL, token_hash text NOT NULL,
  credential_hash text NOT NULL, transport text NOT NULL, transport_fingerprint text NOT NULL,
  provider_id text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0, error_code text NOT NULL DEFAULT '',
  next_attempt_at bigint NOT NULL, lease_until bigint NOT NULL DEFAULT 0, expires_at bigint NOT NULL,
  created_at bigint NOT NULL, updated_at bigint NOT NULL, budget_at bigint NOT NULL, policy_revision integer NOT NULL,
  released boolean NOT NULL DEFAULT false, had_unknown boolean NOT NULL DEFAULT false, audit_id text NOT NULL DEFAULT ''
);
CREATE INDEX mail_jobs_queue ON mail_jobs(next_attempt_at) WHERE state='queued';
CREATE INDEX mail_jobs_account ON mail_jobs(user_id, created_at DESC);
CREATE INDEX mail_jobs_recipient ON mail_jobs(recipient_hash, created_at DESC);
CREATE INDEX mail_jobs_provider ON mail_jobs(provider_id) WHERE provider_id<>'';
CREATE TABLE mail_budget (
  period text PRIMARY KEY, reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),
  ordinary integer NOT NULL DEFAULT 0 CHECK(ordinary>=0)
);
CREATE TABLE mail_attempts (
  id bigserial PRIMARY KEY, job_id text NOT NULL REFERENCES mail_jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL, outcome text NOT NULL, code text NOT NULL DEFAULT '', created_at bigint NOT NULL
);
CREATE TABLE mail_delivery_events (
  id text PRIMARY KEY, provider_id text NOT NULL, kind text NOT NULL, occurred_at bigint NOT NULL,
  received_at bigint NOT NULL, applied boolean NOT NULL DEFAULT false
);
CREATE INDEX mail_delivery_pending ON mail_delivery_events(provider_id) WHERE applied=false;
CREATE TABLE mail_worker_status (id text PRIMARY KEY, updated_at bigint NOT NULL);
