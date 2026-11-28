-- Preserve each submission's model choice even when a report is reused or resumed later.
ALTER TABLE novel_analysis_requests ADD COLUMN provider_preset_id TEXT NOT NULL DEFAULT '';
