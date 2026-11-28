-- Preserve the outline and completed sections independently of the final report.
-- NULL retains compatibility with existing reports and interrupted analyses.
ALTER TABLE novel_analysis_reports ADD COLUMN IF NOT EXISTS draft_json JSONB;
