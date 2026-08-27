-- AI 任务产物（JSON）：供前端在 App 被挂起或重新打开后恢复结果。
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT '';
