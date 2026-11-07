-- Keep normalized text out of chapters: existing SELECT c.* readers must not fetch it twice.
ALTER TABLE chapters ADD COLUMN search_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE chapter_search_text (
  chapter_id text PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL,
  normalizer_version integer NOT NULL,
  search_text text NOT NULL
);

CREATE FUNCTION invalidate_chapter_search_text() RETURNS trigger AS $$
BEGIN
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    NEW.search_revision := OLD.search_revision + 1;
    DELETE FROM chapter_search_text WHERE chapter_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER chapter_search_text_invalidation BEFORE UPDATE OF content ON chapters
FOR EACH ROW EXECUTE FUNCTION invalidate_chapter_search_text();

-- Both directory ordering and book-search cursors use the id tie-breaker.
CREATE INDEX idx_chapters_novel_order_id ON chapters(novel_id, sort_order, id);
