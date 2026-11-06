-- 可丢弃、可从原图重建的展示图；原封面、候选和历史仍保存原始字节。
CREATE TABLE cover_display_images (
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  image_hash TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width IN (320, 1024)),
  -- NULL 表示转码无收益或不支持，直接使用调用方的原图，不重复保存原图。
  data BYTEA,
  content_type TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (novel_id, image_hash, width)
);
CREATE INDEX idx_cover_display_images_created ON cover_display_images(created_at);
