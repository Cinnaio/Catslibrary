-- 内容分级 P2：候选审核、规则版本和批准后的受影响作品应用。
--
-- review_revision 用于管理员审核页的乐观并发保护；rule_version 记录该候选
-- 被批准时所处的完整动态规则集合版本。规则状态表用单行锁串行化批准动作，
-- 避免两个管理员同时批准时生成互相覆盖的版本或部分应用。

ALTER TABLE content_rating_rule_candidates
  ADD COLUMN IF NOT EXISTS review_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT '';

ALTER TABLE content_rating_rule_candidates
  ADD CONSTRAINT content_rating_rule_candidates_review_revision_nonnegative
    CHECK (review_revision >= 0);

CREATE TABLE IF NOT EXISTS content_rating_rule_state (
  id           TEXT PRIMARY KEY CHECK (id = 'global'),
  rule_version TEXT NOT NULL DEFAULT 'restricted-rules-v1',
  updated_by   TEXT NOT NULL DEFAULT '',
  updated_at   BIGINT NOT NULL DEFAULT 0
);

INSERT INTO content_rating_rule_state (id, rule_version, updated_by, updated_at)
VALUES ('global', 'restricted-rules-v1', '', 0)
ON CONFLICT (id) DO NOTHING;
