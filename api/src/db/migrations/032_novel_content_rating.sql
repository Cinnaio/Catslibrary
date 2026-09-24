-- 方案 B：小说内容分级字段（三态）。
-- 设计稿：docs/novel-content-rating-plan-2026-09-23.md
--
-- 为什么是独立列而不是复用 categories：分类是读者可见的题材标签，分级是内容治理
-- 属性；混在一起会让运营改分类时误删分级，且 normalizeCategories 重写分类会吞掉它。
--
-- 为什么列名是 content_rating 而不是 rating：novel_ratings.rating 已被读者 1–5 星
-- 打分占用（001_init.sql），两者都挂在 novel 上，同名会在 join 与 rowToNovel 映射里串味。
--
-- 为什么需要 unknown：全库存量书籍尚未人工判定。若只有两态，默认 general 等于把
-- 全部未判定书静默放行（比现状更危险），默认 restricted 则全站被拦。unknown 让
-- "未判定"成为一个可见、可统计、可收敛的状态。当前读取侧只认此字段，API 启动
-- 会在开始接收请求前运行规则预填；不能单独运行迁移后直接对外提供新前端。
ALTER TABLE novels ADD COLUMN IF NOT EXISTS content_rating TEXT NOT NULL DEFAULT 'unknown';

-- 支撑后台「仅看未标注」筛选与标注进度统计（对齐 idx_novels_status 的既有做法）。
CREATE INDEX IF NOT EXISTS idx_novels_content_rating ON novels(content_rating);
