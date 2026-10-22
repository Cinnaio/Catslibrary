-- 图谱是有效创作档案的派生缓存，档案/起点变化时不复用。
CREATE TABLE novel_story_graphs (
  novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
