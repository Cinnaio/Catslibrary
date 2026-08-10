---
version: 1
slug: "web-src-pages-admin-admin-tsx"
primary_target: "web/src/pages/admin/Admin.tsx"
related_targets: ["web/src/pages/admin/ChaptersTab.tsx","web/src/pages/admin/DashboardTab.tsx","web/src/pages/admin/JobsTab.tsx","web/src/pages/admin/ModerationTab.tsx","web/src/pages/admin/NovelsTab.tsx","web/src/pages/admin/RulesTab.tsx","web/src/pages/admin/SettingsTab.tsx","web/src/pages/admin/AdminShell.tsx","web/src/pages/admin/scrape/CenterView.tsx","web/src/pages/admin/scrape/DiscoverView.tsx","web/src/pages/admin/scrape/SourcesView.tsx","web/src/styles/admin-operations.css"]
---

# Admin 后台 · 表面契约（operate）

> 2026-08 结构重构收尾。DESIGN.md 不动（仍是奶茶·奶油暖纸世界）；本契约只记录后台这唯一表面的策略。

## THESIS

管理后台是一张「受控操作台」：数据密集、动作可预期、每一个表面都有同一个骨架。用户是站长本人（cinnaio），每天的活是核对抓取、改章节、看入库。这个表面要证明的是——shadcn 原语 + 暖纸 tokens 能拼出一张既正统又不像模板的管理后台。

## OWN-WORLD

暖纸世界。`--bg-*` 奶油纸底、`--accent` 茶棕、`--border` 细灰、`--sh-primary` 深棕文字。这一版的自我约束：不引入任何新的视觉词——没有渐变字、没有毛玻璃、没有图标栅格、没有 emoji。所有的「品牌感」来自 tokens 本身 + 圆角 8px 的控件 + 细边框。暗色模式继承同一套 tokens，按 `[data-theme="dark"]` 整体降饱和。

## STORY

站长打开后台：左侧 shadcn Sidebar 给出空间方位，顶栏显示当前 tab 与计数胶囊。内容区是单层级的受控表面——每个 tab 一个页头（标题 + 元信息 + 操作区），表格是数据 tab 的主干，对话框与控件语法全站统一。没有层级翻花，没有第二个骨架。暖纸底色 + 棋盘格线让内容区有一点「桌面」的肌理，但一切为可扫描性服务。

## FIRST VIEWPORT

默认落在「发现」tab：上部工具栏（站点选择 + 搜索 + 采集按钮），中部书籍卡片流。卡片是白底细边框、左缘 3px 品牌色、封面 3:4。首屏传达的是「一个操作台，一组控件，随时可以开始干活的密度」。

## FORM

- 页头解剖：`AdminPage` = title + `meta` 胶囊 + `description` + `actions`。所有 tab 复用，不新造页头。
- 表格即主干：数据 tab（小说 / 章节 / 任务 / 审核 / 采集源）以 Table 为脊柱，行内操作 ghost icon 按钮。
- 对话框解剖：`.admin-dialog`，header / body(可滚) / footer 三段，圆角 16px。
- 控件语法：Input/Button/Textarea 统一 2.25rem 高、0.875rem 字、8px 圆角；secondary/destructive 白底 + 细灰边 + 文字色。
- 圆角语义：卡片 12px、对话框 16px、控件 8px、胶囊 full。
- 移动端（≤640px）：工具栏塌成单列、操作按钮全宽、计数胶囊隐藏。

## FINISH

可维护性的证明就是「类汤裁掉了 60%」：`admin-operations.css` 只剩各 tab 实际引用的规则，`_admin-ui.css` / `_admin-discover.css` 死选择器清零，`tsc` + `build` 全绿。未来加 tab 时：用 shadcn 原语 + tokens，不要加新 CSS 文件；规则进 `admin-operations.css` 并标注消费者。

## 未决

- 后台深浅色：`[data-theme="dark"]` 已跟随全站切换，但暖纸在暗色下的色值是否要再压一层，留待审美终审。
- 终审后如需调整，走 `surface-brief.mjs read web/src/pages/admin/Admin.tsx` 读回本契约再改。
