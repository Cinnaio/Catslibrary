-- Admission is committed before contacting an upstream model. Uncertain calls
-- keep their slot until the calendar-day reset; a process crash cannot refund
-- a potentially billed request. Successful calls reconcile by the same usage ID.
CREATE TABLE ai_quota_reservations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX idx_ai_quota_reservations_user_day ON ai_quota_reservations(user_id, created_at);
