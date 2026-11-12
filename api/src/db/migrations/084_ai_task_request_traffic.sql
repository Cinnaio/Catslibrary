ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS upstream_request_count BIGINT;
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS upstream_request_body_bytes BIGINT;
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS upstream_max_request_body_bytes BIGINT;
