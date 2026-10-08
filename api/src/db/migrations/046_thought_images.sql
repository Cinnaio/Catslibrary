ALTER TABLE thoughts ADD COLUMN has_image BOOLEAN NOT NULL DEFAULT FALSE;

-- 二进制单独存储，避免列表查询加载图片；隐藏/硬删沿用想法的审核流程。
CREATE TABLE thought_images (
  thought_id TEXT PRIMARY KEY REFERENCES thoughts(id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
