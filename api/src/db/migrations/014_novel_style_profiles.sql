-- 小说风格画像：对每部小说一次性提取其语言风格、叙事节奏、角色语气、世界观设定，
-- 续写时拼进 system prompt，把「保持风格一致」这句空话换成模型可执行的具体描述。
-- 一部小说一行（novel_id 唯一）；管理员手动触发刷新，写作中途不变。
CREATE TABLE IF NOT EXISTS novel_style_profiles (
  novel_id   TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  profile    TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0
);
