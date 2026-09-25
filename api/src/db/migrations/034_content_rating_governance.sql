-- 内容分级治理模型：把 content_rating 从裸状态升级为可追溯的治理记录。
--
-- 034 之前的旧数据只有三态字段，没有来源、证据或版本。合法旧值保留为
-- legacy；非法值先记录到审计表，再归一为 unknown，绝不把脏数据猜成 general。

ALTER TABLE novels
  ADD COLUMN IF NOT EXISTS content_rating_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_rating_source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS content_rating_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_rating_evidence TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS content_rating_rule_version TEXT NOT NULL DEFAULT 'legacy-032',
  ADD COLUMN IF NOT EXISTS content_rating_updated_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_rating_updated_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_rating_operation_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS novel_content_rating_audit (
  id                    TEXT PRIMARY KEY,
  novel_id              TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  from_rating           TEXT NOT NULL,
  to_rating             TEXT NOT NULL CHECK (to_rating IN ('general', 'restricted', 'unknown')),
  source                TEXT NOT NULL,
  reason                TEXT NOT NULL DEFAULT '',
  evidence              TEXT NOT NULL DEFAULT '[]',
  rule_version          TEXT NOT NULL DEFAULT '',
  operation_id          TEXT NOT NULL DEFAULT '',
  actor_user_id         TEXT NOT NULL DEFAULT '',
  expected_revision     INTEGER NOT NULL DEFAULT 0,
  resulting_revision    INTEGER NOT NULL DEFAULT 0,
  created_at            BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_novel_content_rating_audit_novel_created
  ON novel_content_rating_audit(novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_novel_content_rating_audit_operation
  ON novel_content_rating_audit(operation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_novels_content_rating_source
  ON novels(content_rating_source, content_rating_updated_at DESC);

UPDATE novels
SET content_rating_updated_at = updated_at
WHERE content_rating_source = 'legacy' AND content_rating_updated_at = 0;

CREATE TEMP TABLE content_rating_invalid_034 ON COMMIT DROP AS
SELECT id, content_rating AS old_rating
FROM novels
WHERE content_rating IS NULL
   OR content_rating NOT IN ('general', 'restricted', 'unknown');

UPDATE novels AS n
SET content_rating = 'unknown',
    content_rating_revision = n.content_rating_revision + 1,
    content_rating_source = 'migration',
    content_rating_reason = '非法历史分级值已归一为 unknown',
    content_rating_evidence = json_build_array(json_build_object('type', 'legacy-value', 'value', COALESCE(i.old_rating, '<null>')))::text,
    content_rating_rule_version = '034-content-rating-governance',
    content_rating_updated_by = 'system',
    content_rating_updated_at = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
    content_rating_operation_id = 'migration-034-content-rating'
FROM content_rating_invalid_034 AS i
WHERE n.id = i.id;

INSERT INTO novel_content_rating_audit
  (id, novel_id, from_rating, to_rating, source, reason, evidence, rule_version, operation_id, actor_user_id, expected_revision, resulting_revision, created_at)
SELECT
  'ratingaudit_034_' || md5(i.id),
  i.id,
  COALESCE(i.old_rating, '<null>'),
  'unknown',
  'migration',
  '非法历史分级值已归一为 unknown',
  json_build_array(json_build_object('type', 'legacy-value', 'value', COALESCE(i.old_rating, '<null>')))::text,
  '034-content-rating-governance',
  'migration-034-content-rating',
  'system',
  0,
  1,
  floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM content_rating_invalid_034 AS i;

ALTER TABLE novels
  ADD CONSTRAINT novels_content_rating_allowed
    CHECK (content_rating IN ('general', 'restricted', 'unknown')),
  ADD CONSTRAINT novels_content_rating_revision_nonnegative
    CHECK (content_rating_revision >= 0);
