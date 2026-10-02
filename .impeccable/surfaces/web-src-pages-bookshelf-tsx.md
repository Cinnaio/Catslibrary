---
version: 1
slug: "web-src-pages-bookshelf-tsx"
primary_target: "web/src/pages/Bookshelf.tsx"
related_targets: ["web/src/styles/profile.css", "web/src/components/SiteHeader.tsx", "web/src/styles/header.css", "web/src/styles/tokens.css"]
---

# Bookshelf 我的书架 · 表面契约

## THESIS

2026-10-02 用户要求直接在正式项目中按已建立的 Claude 风格和现有规则修改书架、个人中心，不制作或改写独立 HTML。用户否定先前四区纵向堆叠的书架方案；本次书架修订使用带计数的分类按钮，一次集中显示一类内容，整理动作就近归于所属记录。个人中心契约与共享 token 保持既有实现。

## OWN-WORLD

沿用 `--bg-secondary` 暖灰画布、`--bg-card` 纸面、`--accent` 暖棕及既有 light/dark 语义色。容器16px圆角、无外描边、阴影、渐变或抬升；封面单独使用共享 `--novel-cover-shadow`。保留知舟品牌及真实封面，不引入 Claude 标识或独立色板。

## STORY

页头：我的书架、说明、同步状态与立即同步。分类行依次为收藏 → 最近阅读 → 书签 → 想法，数量贴在对应按钮；按钮使用 `aria-pressed`，不是 ARIA tabs。一次只显示一个内容区域，其他区域通过 `hidden` 隐藏，各区保留屏幕阅读器标题。收藏与最近阅读使用封面卡片，阅读链接与删除按钮分离。书签/想法使用连续记录纸面，单条分隔线区分条目。

## FIRST VIEWPORT

衬线主标题32px / 500 / 1.5、字距-0.02em，手机1.55rem；说明14px / 1.8。桌面同步区与标题并排，800px及以下在标题下；同步状态12px、polite live region，处理中禁用同步按钮。`.header--paper` 限书架与个人中心，首页 `.header--home` 行为保持既有实现。

## FORM

- 内容最大1080px，区块间距24px；桌面上下48px / 64px，600px及以下上下28px / 40px、水平16px。收窄只限书架，个人中心仍为1200px。
- 分类按钮最小44px高、桌面间距28px、手机20px；选中态使用暖棕下划线。颜色和下划线过渡复用 `--tabs-segmented-transition`，reduced motion 关闭过渡。键盘 `:focus-visible` 为2px暖棕外框、4px偏移。
- 收藏/最近阅读网格1000px以上三列、1000px及以下两列、600px及以下单列，间距16px。卡片最小高152px、桌面及手机内边距18px、内容间距16px。
- 封面固定72×108px、共享 `--radius-sm` 圆角与 `--novel-cover-shadow`。标题使用 `--novel-card-title-size` 14px、两行上限、行高1.5；元数据12px、时间11.2px，沿用共享 token，手机不缩小字号。
- 卡片正文底部留28px给独立整理按钮；按钮在右16px、底12px，桌面最小32px、手机40px。hover 仅色调反馈，无位移。
- 分类按钮桌面14px、手机13px，计数11.2px；区标题仅供屏幕阅读器。记录纸面水平24px、手机20px，记录上下18px；标题14px / 1.7，元数据12px / 1.7，长文字 `overflow-wrap:anywhere`。四类空态背景透明，不保留空纸面。
- reduced motion 下关闭书目卡片及页面按钮过渡。

## BEHAVIOR

保留 `/auth` 返回 `/bookshelf`、现有 loading、真实 API 与本地存储。收藏最多显示12条，最近阅读8条、书签4条、想法4条；这些为既有展示上限。自动/手动同步、最近记录合并与墓碑处理、收藏/历史删除、章节及想法定位跳转均沿用原流程。四区各自有空态，不移植 HTML 演示数据。

## VERIFICATION

本次书架修订类型检查与构建通过；fixture交互检查覆盖分类切换、同步、收藏删除、阅读及记录定位链接、无横向溢出。截图和交互检查使用模拟数据，不代表真实后端同步或删除验证。最终复审已检查本次14张截图，结论为 ship（完成文档同步后），无需进一步修正或采图；该结论针对当前分类方案。
