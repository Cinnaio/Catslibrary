-- 只保护后续写入，不修正或删除既有异常数据。
CREATE OR REPLACE FUNCTION validate_reading_chapter() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'reading_progress' THEN
    IF NEW.deleted_at > 0 THEN RETURN NEW; END IF;
  END IF;
  PERFORM id FROM chapters WHERE id = NEW.chapter_id AND novel_id = NEW.novel_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chapter not found in this novel' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reading_progress_chapter_guard BEFORE INSERT OR UPDATE ON reading_progress
FOR EACH ROW EXECUTE FUNCTION validate_reading_chapter();
CREATE TRIGGER bookmarks_chapter_guard BEFORE INSERT OR UPDATE ON user_bookmarks
FOR EACH ROW EXECUTE FUNCTION validate_reading_chapter();

CREATE OR REPLACE FUNCTION maintain_chapter_derived_data() RETURNS trigger AS $$
DECLARE now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM user_bookmarks WHERE chapter_id = OLD.id;
    UPDATE reading_progress SET chapter_id = '', scroll_percent = 0,
      deleted_at = GREATEST(updated_at + 1, now_ms), updated_at = GREATEST(updated_at + 1, now_ms)
      WHERE chapter_id = OLD.id AND deleted_at = 0;
  END IF;
  IF TG_OP = 'DELETE' OR OLD.content IS DISTINCT FROM NEW.content THEN
    UPDATE ai_generations SET status = 'rejected'
      WHERE chapter_id = OLD.id AND kind = 'summary' AND status = 'published';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chapter_derived_data AFTER UPDATE OF content OR DELETE ON chapters
FOR EACH ROW EXECUTE FUNCTION maintain_chapter_derived_data();
