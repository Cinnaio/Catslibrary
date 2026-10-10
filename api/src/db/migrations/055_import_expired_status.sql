-- 早期 054 已记账的数据库不会重跑后来补入的状态约束变更。
-- 独立版本修复升级路径；054 已包含 expired 的新库执行后保持同样约束。
ALTER TABLE book_import_runs DROP CONSTRAINT IF EXISTS book_import_runs_status_check;
ALTER TABLE book_import_runs ADD CONSTRAINT book_import_runs_status_check
  CHECK (status IN ('preview', 'applied', 'partial', 'rolled_back', 'expired'));
