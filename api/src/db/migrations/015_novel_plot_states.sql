-- 小说情节状态：对每部小说提取结构化的角色处境/伏笔/待解决冲突，
-- 多章续写时拼进 user 消息，防止人设漂移、伏笔遗忘、前后矛盾。
-- 一部小说一行（novel_id 唯一）；管理员手动触发刷新。chapters_through 标记
-- 提取覆盖到第几章，用于判断状态是否落后于最新已发布章节（过期提醒）。
CREATE TABLE IF NOT EXISTS novel_plot_states (
  novel_id          TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  state             TEXT NOT NULL DEFAULT '',
  chapters_through  INTEGER NOT NULL DEFAULT 0,
  model             TEXT NOT NULL DEFAULT '',
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL DEFAULT 0
);
