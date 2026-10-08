-- 控制数据与业务 schema 隔离，业务回滚不会覆盖版本、日志和配置。
-- IF NOT EXISTS 保证旧业务迁移记录恢复后重新应用本迁移仍安全。
CREATE SCHEMA IF NOT EXISTS backup_control;
CREATE TABLE IF NOT EXISTS backup_control.settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS backup_control.targets (
  id TEXT PRIMARY KEY, config TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1, archived BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS backup_control.versions (
  id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, snapshot_at BIGINT NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued', size BIGINT NOT NULL DEFAULT 0,
  digest TEXT NOT NULL DEFAULT '', manifest TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', pinned BOOLEAN NOT NULL DEFAULT FALSE,
  protection BOOLEAN NOT NULL DEFAULT FALSE, trigger TEXT NOT NULL DEFAULT 'manual',
  migration_version INTEGER NOT NULL DEFAULT 0, deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS backup_control.copies (
  version_id TEXT NOT NULL, target_id TEXT NOT NULL, target_config TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', verified_at BIGINT NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
  retry_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(version_id,target_id)
);
CREATE TABLE IF NOT EXISTS backup_control.tasks (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, version_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT '等待执行',
  actor TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}',
  operation_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL, finished_at BIGINT NOT NULL DEFAULT 0,
  heartbeat_at BIGINT NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', result TEXT
);
CREATE INDEX IF NOT EXISTS backup_tasks_queue ON backup_control.tasks(state,created_at);
CREATE TABLE IF NOT EXISTS backup_control.events (
  id BIGSERIAL PRIMARY KEY, task_id TEXT NOT NULL, level TEXT NOT NULL,
  message TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS backup_events_task ON backup_control.events(task_id,id);
CREATE TABLE IF NOT EXISTS backup_control.schedule_runs (
  revision INTEGER NOT NULL, scheduled_at BIGINT NOT NULL, task_id TEXT NOT NULL,
  PRIMARY KEY(revision,scheduled_at)
);
