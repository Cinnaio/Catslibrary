-- Preserve the existing API unit (amount × 100000), allowing fractional units.
-- Historical integer values keep their meaning; previously rounded amounts cannot be recovered.
ALTER TABLE ai_usage ALTER COLUMN cost_millicents TYPE NUMERIC(24, 8) USING cost_millicents::numeric;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS upstream_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cost_source TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cost_currency TEXT NOT NULL DEFAULT '';
