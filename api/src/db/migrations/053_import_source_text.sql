-- 导入原文快照。
-- 诊断复盘（「这一行为什么被当成章节标题」）与 AI 边界复核后的重切都依赖原始行序，
-- 而 payload_json 只保留切分结果，行号无从复原。
-- 与既有快照同表但独立成列：历史列表必须显式列名查询，避免整份文件（上限 25 MB）
-- 被带进列表响应。
ALTER TABLE book_import_runs ADD COLUMN IF NOT EXISTS source_text TEXT NOT NULL DEFAULT '';
