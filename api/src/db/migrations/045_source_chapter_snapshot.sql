-- 历史作品没有目录明细时保持未知，不用总章数推断保护状态。
ALTER TABLE novels ADD COLUMN source_chapter_snapshot JSONB;

-- 换源或调整目录解析规则后，旧目录不能继续提供保护状态。
CREATE FUNCTION invalidate_source_chapter_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_url IS DISTINCT FROM NEW.source_url OR OLD.selectors IS DISTINCT FROM NEW.selectors THEN
    UPDATE novels SET source_chapter_snapshot=NULL, remote_chapter_count=0, update_checked_at=0 WHERE id=NEW.novel_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_source_chapter_snapshot
AFTER UPDATE OF source_url, selectors ON scrape_configs
FOR EACH ROW EXECUTE FUNCTION invalidate_source_chapter_snapshot();
