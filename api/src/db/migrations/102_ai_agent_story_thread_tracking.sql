-- Author plans and verified quotations remain separate from generated story facts.
ALTER TABLE ai_agent_story_thread_plans DROP CONSTRAINT ai_agent_story_thread_plans_disposition_check;
ALTER TABLE ai_agent_story_thread_plans ADD CONSTRAINT ai_agent_story_thread_plans_disposition_check
  CHECK (disposition IN ('advance','later','hold','partial','resolved'));
ALTER TABLE ai_agent_story_thread_plans ADD COLUMN target_chapter_number INTEGER
  CHECK (target_chapter_number BETWEEN 1 AND 100000);
ALTER TABLE ai_agent_story_thread_plans ADD COLUMN target_stage TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_agent_story_thread_plans ADD COLUMN progress JSONB NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(progress) = 'array');
