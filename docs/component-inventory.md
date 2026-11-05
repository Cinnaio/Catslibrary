# 生产组件归属清单

2026-11-05 站点设置由 `pages/admin/SiteSettingsTab.tsx` 与 `site-settings.module.css` 持有布局及各页独立读取状态；`SiteSettingsNavigation.tsx` 复用注册表元数据和共享 Tabs，统一六个视图与窄屏滚动。`site-settings-views.ts` 解析站点与旧 AI 设置地址，Admin 对这些地址复用同一个持久挂载的工作区；`ai/AiSettingsWorkspace.tsx` 按需加载并保留模型与参数两页的独立快照、草稿，复用实际 AiConfigPanel 与 AiParamsPanel，AiTab 仅负责创作。旧站点设置全局 CSS 退出运行时，卡片、按钮、开关、勾选、异步状态仍归共享层；内容安全仅呈现策略卡片，布局继续归 `content-policy.module.css`。共享 Tabs 首次直接定位，后续选择平移；不新增公共层业务依赖。

2026-11-05 审核页由 `pages/admin/ModerationTab.tsx` 与 `moderation.module.css` 持有筛选布局、正文摘要和来源信息；全文与原引用复用 `shared/ReadingDialog`，危险操作复用 `AdminRowActions` 及原确认流程，表格及窄屏记录复用 `AdminDataPanel`／`Table`。移除旧审核响应式文件、全局想法单元格及审核筛选皮肤，不新增公共层业务依赖。

2026-11-05 书源与追更明细的导航、筛选布局、书名与时间呈现由 `pages/admin/SourceAnalyticsTab.tsx` 和 `source-analytics.module.css` 持有，次要筛选使用共享 Popover、FormField 与 SearchSelect，结果使用 AdminStatusBadge，数据面板表面归 AdminDataPanel。透视统计拆为同场景的 `pages/admin/SourceDistribution.tsx`，四项摘要与分类内容共用书源模块 CSS，源站表格完整使用共享 AdminDataPanel 列定义及 Table 原语，跨列展开行由共享表格的 data-details 规则处理，移除旧透视卡片及明细皮肤、跨页工具栏覆盖；来源详情仍沿用所属模块样式。未新增公共组件或反向业务依赖。

2026-11-05 任务中心详情由 `pages/admin/TaskWorkspace.tsx` 及其 CSS Module 持有，共享摘要、结果、错误、时间和 ID 复制布局；抓取与 AI 页面提供真实数据及业务动作。该组合保留在后台任务场景层，不新增通用层反向依赖；其他抓取日志详情继续保留各自的完整日志与失败章节流程。

2026-11-05 阅读优先布局归入 `shared/ReadingDialog` 及其 CSS Module，集中维护标题、工具栏、正文／编辑框、辅助长文折叠和底部插槽，AI 生成内容与组件展厅直接使用同一生产实现；AI 模块只保留发布表单布局和业务状态。共享层不引用 AI、后台数据或业务接口，退出旧 AI 全局弹窗皮肤。

基于 `node scripts/check-web-components.mjs --inventory` 的清单补充阅读弹窗归属；105 个组件文件，249 个生产源码模块。使用方数量包含开发展厅，不包含测试。表格记录保留或迁移依据，不表示所有控件需要重写；组件内部页面级子组件按所属页面／工作流保留。

2026-11-05 代理设置页面的布局、诊断结果与帮助区域由 `pages/admin/scrape/proxy.module.css` 持有，字段、按钮、加载反馈和分区标题继续复用生产共享组件；移除旧代理页面样式及全局兼容选择器。

2026-11-05 AI 作品创作台的布局与创作子区样式由 `pages/admin/ai/writing-workspace.module.css` 持有，退出三份旧样式中的创作选择器。作品、起点、模式、分区导航和生成操作复用共享字段、SearchSelect、Tabs 与 Button；审阅及产出复用 `AiGenerationsPanel`，任务结束通过刷新标记更新列表，保留正在编辑的草稿。未新增公共组件或改变公共层依赖方向。

| 文件 | 层级 | 使用方 | 样式所有权 | 结论 |
| --- | --- | ---: | --- | --- |
| `components/AccountMenu.tsx` | 应用／业务 | 1 | `styles/account-menu.css` | 保留：账户导航与会话动作 |
| `components/admin/AdminContentRatingBadge.tsx` | 后台场景 | 4 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminDataPanel.tsx` | 后台场景 | 16 | `styles/admin/components/readability.css`、`styles/admin/components/table-motion.css`、`styles/admin/components/tables.css`、`components/admin/admin-data-panel.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程；表面由组件自身维护，不依赖页面层级 |
| `components/admin/AdminFloatingDock.tsx` | 后台场景 | 5 | `styles/admin/components/floating-dock.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminModelTime.tsx` | 后台场景 | 1 | `components/admin/AdminModelTime.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminPage.tsx` | 后台场景 | 17 | `components/admin/admin-page.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminRowActions.tsx` | 后台场景 | 6 | `styles/admin/components/row-actions.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminSelectionBar.tsx` | 后台场景 | 6 | `styles/admin/components/selection.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminStatusBadge.tsx` | 后台场景 | 31 | `styles/admin/components/status-badges.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminTabHeader.tsx` | 后台场景 | 1 | `components/admin/admin-page.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminToolbar.tsx` | 后台场景 | 13 | `components/admin/AdminToolbar.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BatchNovelFollowupDialog.tsx` | 后台场景 | 2 | `styles/admin/pages/novel-followup.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BookImportChapterResolver.tsx` | 后台场景 | 1 | `styles/input-fields.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BookImportDialog.tsx` | 后台场景 | 2 | `styles/input-fields.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BookImportHistoryDialog.tsx` | 后台场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/ImportDiagnosticsPanel.tsx` | 后台场景 | 1 | `styles/input-fields.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/NovelDeleteDialog.tsx` | 后台场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/NovelEditorDialog.tsx` | 后台场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/NovelFollowupDialog.tsx` | 后台场景 | 3 | `styles/admin/pages/novel-followup.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/NovelRelatedSources.tsx` | 后台场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/NovelUpdateTag.tsx` | 后台场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/NovelVisibilityField.tsx` | 后台场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/ScrapeTaskDetailsDialog.tsx` | 后台场景 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/SupplementarySourcesDialog.tsx` | 后台场景 | 2 | `styles/input-fields.css`、`styles/supplementary-sources.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/AdultUnlockDialog.tsx` | 应用／业务 | 2 | `styles/content-policy.css`、`styles/input-fields.css`、`styles/adult-unlock-dialog.css` | 保留：内容策略验证流程 |
| `components/AppErrorBoundary.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：应用异常与整页恢复 |
| `components/CatchupRecap.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：小说阅读回顾业务 |
| `components/ContentPolicyStatus.tsx` | 应用／业务 | 2 | `styles/content-policy.css` | 保留：内容访问检查状态 |
| `components/ContentRestrictionNotice.tsx` | 应用／业务 | 3 | `styles/content-policy.css` | 保留：分级门禁与解锁入口 |
| `components/feedback.tsx` | 应用／业务 | 43 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：应用级确认与通知上下文 |
| `components/icons.tsx` | 应用／业务 | 6 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：共享 SVG 图形，不包含业务状态 |
| `components/identity/UserAvatar.tsx` | 业务适配 | 10 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：账户资源地址与基础头像呈现分离 |
| `components/Layout.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：路由布局与页面外壳适配 |
| `components/NovelCard.tsx` | 应用／业务 | 2 | `components/novel-card.module.css` | 保留：小说目录与阅读/收藏状态 |
| `components/NovelCoverStatus.tsx` | 应用／业务 | 2 | `styles/novel-indicators.css` | 保留：小说封面业务标记 |
| `components/PageSeo.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：路由 SEO 与品牌配置 |
| `components/PageState.tsx` | 应用／业务 | 7 | `styles/page-state.css` | 保留：控制整页外壳的异常呈现，区别于面板空态 |
| `components/reader/BookmarkPanel.tsx` | 阅读场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ChapterIllustrations.tsx` | 阅读场景 | 2 | `styles/select-fields.css`、`styles/input-fields.css`、`styles/chapter-illustrations.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ChapterRecap.tsx` | 阅读场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/MobileSheets.tsx` | 阅读场景 | 1 | `styles/input-fields.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/SettingsControls.tsx` | 阅读场景 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ThoughtImage.tsx` | 阅读场景 | 2 | `styles/thoughts.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ThoughtPanel.tsx` | 阅读场景 | 1 | `styles/thoughts.css`、`styles/input-fields.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/VirtualList.tsx` | 阅读场景 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/ReadingDataPanel.tsx` | 应用／业务 | 1 | `styles/input-fields.css` | 保留：账户阅读数据检查与恢复 |
| `components/ReadingStatsPanel.tsx` | 应用／业务 | 1 | `styles/select-fields.css`、`styles/input-fields.css` | 保留：账户阅读统计 |
| `components/ReauthenticationDialog.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：敏感操作近期身份确认 |
| `components/RouteLoading.tsx` | 应用／业务 | 3 | `styles/loading-indicators.css`、`styles/route-loading.css` | 保留：路由切换与外壳占位 |
| `components/shared/AsyncStates.tsx` | 通用组合 | 21 | `styles/loading-indicators.css`、`components/shared/AsyncStates.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/CellText.tsx` | 通用组合 | 2 | `components/shared/CellText.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/ConfirmationDialog.tsx` | 通用组合 | 2 | `components/shared/ConfirmationDialog.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/DialogFrame.tsx` | 通用组合 | 28 | `components/shared/DialogFrame.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/EmptyState.tsx` | 通用组合 | 15 | `components/shared/EmptyState.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/FloatingPageTools.tsx` | 通用组合 | 2 | `components/shared/FloatingPageTools.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/FormField.tsx` | 通用组合 | 18 | `components/shared/FormField.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/Pagination.tsx` | 通用组合 | 19 | `components/shared/Pagination.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/PanelHeading.tsx` | 通用组合 | 8 | `components/shared/PanelHeading.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/ReadingDialog.tsx` | 通用组合 | 2 | `components/shared/ReadingDialog.module.css` | 共享：正文优先的阅读窗及工具栏、正文、编辑框、辅助折叠；业务由调用方传入 |
| `components/shared/SearchField.tsx` | 通用组合 | 12 | `components/shared/SearchField.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/SearchSelect.tsx` | 通用组合 | 30 | `styles/select-fields.css`、`components/shared/SearchSelect.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/TimeField.tsx` | 通用组合 | 2 | `components/shared/TimeField.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/SiteBrandingSync.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：站点品牌同步 |
| `components/SiteNotice.tsx` | 应用／业务 | 1 | `styles/site-notice.css` | 保留：站点公告与工作区位置 |
| `components/ThemeMenu.tsx` | 应用／业务 | 3 | `styles/theme-menu.css`、`styles/input-fields.css` | 保留：应用主题偏好入口 |
| `components/TurnstileTestWidget.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：站点验证码配置诊断 |
| `components/ui/alert-dialog.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/alert.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/avatar.tsx` | 基础控件 | 1 | `styles/identity.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/badge.tsx` | 基础控件 | 11 | `styles/identity.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/button.tsx` | 基础控件 | 100 | `components/ui/button.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/card.tsx` | 基础控件 | 13 | `components/ui/card.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/checkbox.tsx` | 基础控件 | 16 | `components/ui/checkbox.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/collapsible.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/command.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/control-appearance.tsx` | 基础控件 | 9 | `components/ui/control-appearance.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/dialog.tsx` | 基础控件 | 32 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/dropdown-menu.tsx` | 基础控件 | 6 | `styles/dropdown-menu.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/field-context.tsx` | 基础控件 | 6 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/filter-chip.tsx` | 基础控件 | 2 | `components/ui/filter-chip.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/initial-avatar.tsx` | 基础控件 | 2 | `styles/identity.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/input.tsx` | 基础控件 | 41 | `styles/native-form-fields.css`、`styles/input-fields.css`、`components/ui/input.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/label.tsx` | 基础控件 | 23 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/panel.tsx` | 基础控件 | 5 | `components/ui/panel.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/popover.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/progress.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/radio-group.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/scroll-area.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/select.tsx` | 基础控件 | 8 | `styles/native-form-fields.css`、`styles/select-fields.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/separator.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/sheet.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/sidebar.tsx` | 基础控件 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/skeleton.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/sonner.tsx` | 基础控件 | 1 | `styles/toast-feedback.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/spinner.tsx` | 基础控件 | 17 | `components/ui/spinner.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/switch.tsx` | 基础控件 | 7 | `components/ui/switch.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/table.tsx` | 基础控件 | 15 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/tabs.tsx` | 基础控件 | 16 | `components/ui/tabs.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/textarea.tsx` | 基础控件 | 18 | `styles/native-form-fields.css`、`styles/input-fields.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/toggle-group.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/toggle.tsx` | 基础控件 | 2 | `components/ui/toggle.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/tooltip.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/VisitTracker.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：访问统计副作用 |
| `components/workspace/NovelWorkspaceLinks.tsx` | 工作区场景 | 1 | `components/workspace/novel-workspace-links.module.css` | 保留：共享外壳或作品上下文导航 |
| `components/workspace/WorkspaceShell.tsx` | 工作区场景 | 2 | `styles/input-fields.css`、`components/workspace/workspace-shell.module.css` | 保留：共享外壳或作品上下文导航 |
