-- 差异报告属于备份控制面，不随 public 业务数据回滚。
CREATE SCHEMA IF NOT EXISTS backup_control;
CREATE TABLE IF NOT EXISTS backup_control.restore_impacts (
  task_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'building' CHECK (state IN ('building','ready','failed')),
  snapshot_at BIGINT NOT NULL,
  completed_at BIGINT NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL DEFAULT 0,
  settings_revision INTEGER NOT NULL,
  rehearsal_label TEXT NOT NULL,
  backup_digest TEXT NOT NULL,
  live_fingerprint TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS backup_control.restore_impact_items (
  task_id TEXT NOT NULL REFERENCES backup_control.restore_impacts(task_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  group_key TEXT NOT NULL,
  table_name TEXT NOT NULL,
  change TEXT NOT NULL CHECK (change IN ('add','modify','remove')),
  data JSONB NOT NULL,
  PRIMARY KEY(task_id,sequence)
);
CREATE INDEX IF NOT EXISTS backup_restore_impact_items_group ON backup_control.restore_impact_items(task_id,group_key,sequence);
