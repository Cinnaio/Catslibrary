-- AI 画像来源：记录提取时真正使用的章节范围，防止回到历史章节时误用未来画像。
ALTER TABLE novel_style_profiles ADD COLUMN IF NOT EXISTS source_json TEXT NOT NULL DEFAULT '';
ALTER TABLE novel_plot_states ADD COLUMN IF NOT EXISTS source_json TEXT NOT NULL DEFAULT '';
ALTER TABLE novel_relationship_profiles ADD COLUMN IF NOT EXISTS source_json TEXT NOT NULL DEFAULT '';
