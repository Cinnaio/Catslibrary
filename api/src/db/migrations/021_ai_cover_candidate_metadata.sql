-- AI 封面候选的可追溯视觉元数据：题材、风格、构图与 variationId。
ALTER TABLE ai_cover_candidates ADD COLUMN IF NOT EXISTS metadata TEXT NOT NULL DEFAULT '';
