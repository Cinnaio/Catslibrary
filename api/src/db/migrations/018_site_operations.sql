CREATE TABLE site_visits (
  id           TEXT PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  path         TEXT NOT NULL,
  visited_at   BIGINT NOT NULL
);

CREATE INDEX idx_site_visits_visited_at ON site_visits(visited_at DESC);
CREATE INDEX idx_site_visits_visitor_time ON site_visits(visitor_hash, visited_at DESC);
