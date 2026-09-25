-- 内容分级 P1：把人工确认结果沉淀为待审核规则候选。
--
-- 候选只记录经验，不在本迁移或本阶段直接改变 shared/restricted-rules.ts。
-- 规则是否生效、会影响哪些 unknown 作品，留给后续预览与批准阶段处理。

CREATE TABLE IF NOT EXISTS content_rating_rule_candidates (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('category', 'phrase')),
  value             TEXT NOT NULL,
  normalized_value  TEXT NOT NULL,
  target_rating     TEXT NOT NULL DEFAULT 'restricted' CHECK (target_rating = 'restricted'),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by        TEXT NOT NULL DEFAULT '',
  created_at        BIGINT NOT NULL,
  reviewed_by       TEXT NOT NULL DEFAULT '',
  reviewed_at       BIGINT NOT NULL DEFAULT 0,
  review_reason     TEXT NOT NULL DEFAULT '',
  updated_at        BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_rating_rule_candidates_key
  ON content_rating_rule_candidates(kind, normalized_value);
CREATE INDEX IF NOT EXISTS idx_content_rating_rule_candidates_status
  ON content_rating_rule_candidates(status, updated_at DESC);

-- 一个候选可以由多本人工确认的作品共同支持。P1 只负责收集例子，
-- P2 再根据 example_count 和具体作品做影响范围预览。
CREATE TABLE IF NOT EXISTS content_rating_rule_candidate_examples (
  id                     TEXT PRIMARY KEY,
  candidate_id           TEXT NOT NULL REFERENCES content_rating_rule_candidates(id) ON DELETE CASCADE,
  novel_id               TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  novel_rating_revision  INTEGER NOT NULL,
  operation_id           TEXT NOT NULL DEFAULT '',
  reason                 TEXT NOT NULL DEFAULT '',
  evidence               TEXT NOT NULL DEFAULT '[]',
  created_by             TEXT NOT NULL DEFAULT '',
  created_at             BIGINT NOT NULL,
  UNIQUE (candidate_id, novel_id, novel_rating_revision)
);

CREATE INDEX IF NOT EXISTS idx_content_rating_rule_candidate_examples_candidate
  ON content_rating_rule_candidate_examples(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_rating_rule_candidate_examples_novel
  ON content_rating_rule_candidate_examples(novel_id, created_at DESC);
