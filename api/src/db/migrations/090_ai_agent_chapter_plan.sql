ALTER TABLE ai_agent_sessions ADD COLUMN chapter_plan JSONB;
ALTER TABLE ai_agent_sessions ADD COLUMN chapter_plan_operation_id TEXT NOT NULL DEFAULT '';
