CREATE TABLE source_ranking_snapshots (
  source_id TEXT NOT NULL,
  ranking_id TEXT NOT NULL,
  entries JSONB NOT NULL,
  refreshed_at BIGINT NOT NULL,
  PRIMARY KEY (source_id, ranking_id)
);
