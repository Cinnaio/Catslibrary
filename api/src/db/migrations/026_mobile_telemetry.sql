-- 移动端可观测性：只保存匿名安装/会话摘要与经服务端限制的诊断属性。
-- 不保存用户 ID、IP、User-Agent、小说正文或搜索文本。
CREATE TABLE mobile_telemetry (
  id                TEXT PRIMARY KEY,
  install_hash      TEXT NOT NULL,
  session_hash      TEXT NOT NULL DEFAULT '',
  client_event_id   TEXT NOT NULL,
  event_type        TEXT NOT NULL DEFAULT 'event',
  event_name        TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'info',
  app_version       TEXT NOT NULL DEFAULT '',
  build_version     TEXT NOT NULL DEFAULT '',
  os_version        TEXT NOT NULL DEFAULT '',
  device_model      TEXT NOT NULL DEFAULT '',
  properties        TEXT NOT NULL DEFAULT '{}',
  client_created_at BIGINT NOT NULL DEFAULT 0,
  received_at       BIGINT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  admin_note        TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX idx_mobile_telemetry_install_event
  ON mobile_telemetry(install_hash, client_event_id);
CREATE INDEX idx_mobile_telemetry_received
  ON mobile_telemetry(received_at DESC);
CREATE INDEX idx_mobile_telemetry_status_received
  ON mobile_telemetry(status, received_at DESC);
CREATE INDEX idx_mobile_telemetry_type_received
  ON mobile_telemetry(event_type, received_at DESC);
