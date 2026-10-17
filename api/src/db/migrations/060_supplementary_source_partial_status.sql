-- 早期 059 已记账的实例不会重跑同名迁移，必须单独升级状态约束。
-- 只扩充允许的状态，不重建来源表，也不改动书籍、章节和绑定。
ALTER TABLE supplementary_sources
  DROP CONSTRAINT IF EXISTS supplementary_sources_status_check,
  ADD CONSTRAINT supplementary_sources_status_check
    CHECK (status IN ('never', 'ok', 'partial', 'error'));
