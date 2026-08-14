-- 小说关系画像：对每部小说提取角色关系动态、权力结构、心理边界与互动尺度基调。
-- 与风格画像（语言/叙事/对话特征）、情节状态（当前剧情进展）区分：
-- 关系画像是「人物之间的稳定关系底色」，几十章内不变，属于长期创作纪律，续写时拼进 system prompt。
-- 一部小说一行（novel_id 唯一）；管理员手动触发刷新。
CREATE TABLE IF NOT EXISTS novel_relationship_profiles (
  novel_id   TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  profile    TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0
);
