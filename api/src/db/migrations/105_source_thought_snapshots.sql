-- 来源评论独立保存；章节删除级联清理，正文任务与评论任务独立完成。
CREATE TABLE source_thought_chapters (
  chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_label TEXT NOT NULL,
  chapter_url TEXT NOT NULL,
  book_url TEXT NOT NULL,
  paragraphs JSONB,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','syncing','partial','completed','unavailable')),
  generation TEXT NOT NULL,
  needs_counts BOOLEAN NOT NULL DEFAULT TRUE,
  checked_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  retry_at BIGINT NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX source_thought_queue ON source_thought_chapters(retry_at, updated_at) WHERE state <> 'completed';
CREATE TABLE source_thought_lists (
  chapter_id TEXT NOT NULL REFERENCES source_thought_chapters(chapter_id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL DEFAULT '',
  paragraph_index INTEGER NOT NULL,
  paragraph_hash TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  seen_cursors TEXT[] NOT NULL DEFAULT '{}',
  page_count INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (chapter_id, paragraph_index, paragraph_hash, parent_id)
);
CREATE TABLE source_thought_items (
  chapter_id TEXT NOT NULL REFERENCES source_thought_chapters(chapter_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  paragraph_index INTEGER NOT NULL,
  paragraph_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  ordinal BIGSERIAL NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (chapter_id, parent_id, id)
);
CREATE INDEX source_thought_items_page ON source_thought_items(chapter_id, paragraph_index, paragraph_hash, parent_id, ordinal) WHERE NOT hidden;

-- 文件融合、本机抓取和章节接口也登记待办；适配器识别留给应用层，不在数据库写死书源。
CREATE TABLE source_thought_enrollments (
  chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  revision TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  created_at BIGINT NOT NULL DEFAULT (extract(epoch FROM clock_timestamp()) * 1000)::bigint
);
CREATE FUNCTION enqueue_source_thought_chapter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.source_url<>'') OR (TG_OP='UPDATE' AND NEW.source_url IS DISTINCT FROM OLD.source_url) THEN
    INSERT INTO source_thought_enrollments(chapter_id) VALUES(NEW.id)
      ON CONFLICT(chapter_id) DO UPDATE SET revision=excluded.revision,created_at=excluded.created_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_thought_chapter_enrollment AFTER INSERT OR UPDATE OF source_url ON chapters
  FOR EACH ROW EXECUTE FUNCTION enqueue_source_thought_chapter();
