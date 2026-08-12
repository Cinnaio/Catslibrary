-- AI 任务记录创建参数（JSON）：失败/取消后可一键按原参数重试
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS params TEXT NOT NULL DEFAULT '';
