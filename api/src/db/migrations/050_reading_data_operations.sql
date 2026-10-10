-- Account-owned operation receipts make confirmed repairs/restores auditable and retryable.
CREATE TABLE reading_data_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('repair', 'restore')),
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, operation_id)
);
CREATE INDEX reading_data_operations_user_created ON reading_data_operations(user_id, created_at DESC);
