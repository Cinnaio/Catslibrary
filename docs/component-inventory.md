# 生产组件归属清单

由 `node scripts/check-web-components.mjs --inventory` 从当前源码生成；104 个组件文件，248 个生产源码模块。使用方数量包含开发展厅，不包含测试。表格记录保留或迁移依据，不表示所有控件需要重写；组件内部页面级子组件按所属页面／工作流保留。

| 文件 | 层级 | 使用方 | 样式所有权 | 结论 |
| --- | --- | ---: | --- | --- |
| `components/AccountMenu.tsx` | 应用／业务 | 1 | `styles/account-menu.css` | 保留：账户导航与会话动作 |
| `components/admin/AdminContentRatingBadge.tsx` | 后台场景 | 4 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminDataPanel.tsx` | 后台场景 | 17 | `styles/admin/components/readability.css`、`styles/admin/components/table-motion.css`、`styles/admin/components/tables.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminFloatingDock.tsx` | 后台场景 | 5 | `styles/admin/components/floating-dock.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminModelTime.tsx` | 后台场景 | 1 | `components/admin/AdminModelTime.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminPage.tsx` | 后台场景 | 17 | `components/admin/admin-page.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminRowActions.tsx` | 后台场景 | 6 | `styles/admin/components/row-actions.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminSelectionBar.tsx` | 后台场景 | 6 | `styles/admin/components/selection.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminStatusBadge.tsx` | 后台场景 | 28 | `styles/admin/components/status-badges.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
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
| `components/shared/AsyncStates.tsx` | 通用组合 | 18 | `styles/loading-indicators.css`、`components/shared/AsyncStates.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/CellText.tsx` | 通用组合 | 2 | `components/shared/CellText.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/ConfirmationDialog.tsx` | 通用组合 | 2 | `components/shared/ConfirmationDialog.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/DialogFrame.tsx` | 通用组合 | 28 | `components/shared/DialogFrame.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/EmptyState.tsx` | 通用组合 | 14 | `components/shared/EmptyState.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/FloatingPageTools.tsx` | 通用组合 | 2 | `components/shared/FloatingPageTools.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/FormField.tsx` | 通用组合 | 18 | `components/shared/FormField.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/Pagination.tsx` | 通用组合 | 19 | `components/shared/Pagination.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/PanelHeading.tsx` | 通用组合 | 8 | `components/shared/PanelHeading.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
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
| `components/ui/card.tsx` | 基础控件 | 14 | `components/ui/card.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
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
| `components/ui/label.tsx` | 基础控件 | 24 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
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
| `components/ui/spinner.tsx` | 基础控件 | 11 | `components/ui/spinner.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
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
