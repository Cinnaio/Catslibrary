# 生产组件归属清单

2026-11-08 节奏计时：`pages/Tempo.tsx` 持有独立工具页面，布局归 `tempo.module.css`；复用 Panel、Button、FilterChip、FormField、Input、Switch、EmptyState 与 ConfirmationDialog，不新增公共控件。计时状态、浏览器音频和账号隔离的本机记录分别归 `lib/tempo.ts`、`lib/tempo-audio.ts` 与三个 `useTempo*` hook；共享组件不导入这些场景逻辑。路由按需加载，桌面与手机入口由 WorkspaceShell 持有。组件边界检查为 108 个组件、285 个源码模块。

2026-11-07 Web 全站动效：`components/ui/motion.tsx` 与自带 CSS Module 维护分区、折叠和原生说明过渡；`overlay-motion.module.css` 统一共享浮层节奏。`useMotionPresence` 持有退出与焦点隔离，`useListMotion` 仅响应成功用户操作，调用方继续持有请求与账户上下文；保存及批量操作条的退出与占位归 `AdminFloatingDock`。组件展厅直接使用生产实现，不新增业务依赖或动效库。

2026-11-07 取消管理员二次验证：移除 `ReauthenticationDialog`、事件协调模块、入口挂载和专用样式；备份恢复继续由 `BackupsTab` 持有版本与影响确认，使用现有共享表单与弹窗。账号人机验证继续由 `SecurityChallengeDialog` 持有。组件检查为 107 个组件、276 个源码模块。

2026-11-07 首屏与大目录优化：`Pagination` 保留页码、跳页与页大小契约，`PaginationPageSize` 仅在提供页大小选择时加载 Radix Select；两者共用 `Pagination.css`，展厅仍通过原分页示例覆盖该控件。作品详情的章节筛选、每页 100 章、页码和阅读位置跳转由 `pages/Novel.tsx` 持有，入场与过渡样式归 `novel.module.css`；阅读器沿用已有虚拟列表。组件检查为 108 个组件、278 个源码模块。

2026-11-07 邮件安全配置由 `pages/admin/MailSecuritySettings.tsx` 持有配置读取、密码草稿、队列初始化、回调字段和失败保留；`SecurityCenterTab` 协调统一原因确认、状态刷新及真实投递锁，`MailSettings` 接收相邻配置的忙碌／草稿状态。队列与回调各自使用 Card／PanelHeading／CardContent 标准面板，测试另用独立面板，与 SMTP、站点设置统一；复用 FormField、Input、Button、AdminStatusBadge 与既有异步状态。仅使用 `security-center.module.css` 既有双栏和表单布局，删除专用小标题、状态文字及间距样式，没有新增公共层业务依赖。组件边界检查为 107 个共享／业务组件、275 个生产源码模块。

2026-11-07 邮箱域名黑白名单归 `SecurityPolicyEditor` 持有表单草稿、开关和校验呈现，复用 Card／PanelHeading、FormField、Textarea、Switch 与原保存确认；名单输入区的高度和纵向调整归 `security-center.module.css`。`shared/email-domain-policy.ts` 为 Web 和 API 共用的纯名单解析、规范化及域名匹配逻辑，不引入 UI、请求或存储依赖；事件及队列原因继续由 `security-center-format.ts` 显示。没有新增生产组件，组件边界检查仍为 107 个共享／业务组件、274 个生产源码模块。

2026-11-07 安全中心界面统一：`SecurityCenterTab` 保留视图、请求、草稿、权限及操作确认；`SecurityOverviewPanel` 持有用量与异常呈现，`SecurityPolicyEditor` 持有策略分组和即时字段校验，`security-center-format.ts` 集中维护显示文案，不引入共享层业务依赖。复用默认 Tabs、AdminToolbar、SearchSelect、AdminDataPanel、PanelHeading、FormField 与 DialogFrame；双栏、键值信息及手机布局归 `security-center.module.css`，不重绘共享导航、表单控件或状态皮肤。邮件配置通过状态／草稿回调与安全中心协作，旧站点入口继续可用。组件边界检查为 107 个共享／业务组件、274 个生产源码模块。

2026-11-07 安全与风控六视图由 `pages/admin/SecurityCenterTab.tsx` 与 `security-center.module.css` 持有；邮件配置沿用 `MailSettings`，共享字段、Tabs、表格、异步状态、DialogFrame 和保存条维护各自外观。`SecurityChallengeDialog` 是应用级账号验证场景，协议协调在 `lib/security-challenge.ts`；验证码脚本加载统一归 `lib/turnstile.ts`，成人验证与配置测试共用，不从成人弹窗导入业务样式。共享 UI 不新增账号或 API 依赖。

2026-11-07 书籍导入的外框、步骤、来源表单、文件摘要、ZIP 书单与底部布局由 `components/admin/BookImportDialog.module.css` 持有；移除 `styles/book-import.css` 中对应规则，后者继续维护差异核对、解析诊断与导入历史。复用共享 DialogFrame、Tabs、Button 及字段控件，预览、匹配、确认和撤回仍由导入场景持有，不增加共享层业务依赖。

2026-11-07 小说选择的完整取数由 `lib/admin-novel-index.ts` 分页读取管理员紧凑书目，创作、章节、补充来源绑定与任务标题索引共用，不把公开书库第一页或固定索引上限当成全库。SearchSelect 仍为不取业务数据的共享控件，负责完整候选筛选、首批 100 项及继续显示；AI 写作和封面的选项同时提供作者，章节和写作提供加载／错误与重试。封面原有完整分页取数保留，使用共享继续显示浏览后续匹配；补充来源保留外置搜索框及受控结果，不再重复做标题过滤。

2026-11-06 手机作品库条目由 `pages/admin/NovelsTab.tsx` 的内部 `MobileNovelSummary` 与 `novels.module.css` 持有，使用 700px 断点将同一作品记录切换为左封面、右侧身份与元数据、底部更新和来源；701px 以上保留原表格与记录卡。Checkbox、Button、AdminRowActions、NovelUpdateTag 继续复用，编辑入口只在手机移入原行菜单，选择、分页、排序与请求仍归 NovelsTab；跨列手机摘要通过显式 `data-record` 标记继续参与共享阶梯动效，不将空态或详情行纳入入场。

2026-11-06 插图编辑外壳复用共享 DialogFrame／DialogBody，桌面两列预览与配置、手机单列，布局及预览由 `ChapterIllustrations.module.css` 持有。公共 DialogContent 新增可选 `overlayClassName` 用于场景遮罩层级，保持默认调用方不变；图片选择使用共享 Button 唤起原文件输入，位置搜索、字段及操作继续复用 SearchSelect／FormField／Textarea／Button，段落锚点、版本与保存仍归插图组件。

2026-11-06 阅读页统一重构以 `pages/Reader.tsx`／`reader.module.css` 持有稳定顶栏、阅读纸面、目录和移动面板布局，删除 `styles/reader-responsive.css` 与 `styles/bookmarks.css` 的旧覆盖；开发展厅读取同一生产纸面样式。书签列表由 `BookmarkPanel.module.css` 持有，空态与操作复用 EmptyState／Button；手机分区复用 Tabs、目录复用 SearchField，设置继续复用 Button／Switch，想法与插图管理在原样式所有者内统一主题及留白。阅读宽度与工具栏解耦，700px 为阅读器一致断点；数据、缓存、权限、进度、设置同步与原 URL 继续归原所有者。

2026-11-06 插图插入位置复用共享 SearchSelect 的搜索、选择、焦点及字段语义；组件新增可选 `popoverClassName`，插图模块仅通过自身 CSS Module 持有触发器宽度与浮层堆叠顺序。插入位置与展示宽度统一跟随共享 `--control-height`，移除原生位置下拉。

2026-11-06 章节插图编辑布局由 `components/reader/ChapterIllustrations.module.css` 持有，`ChapterIllustrations.tsx` 继续持有段落锚点、图片请求和版本保存；标题、预览、位置上下文及头尾留白不使用装饰分隔线。图注复用 FormField 与 Textarea，宽度复用 Button 分段选项；`styles/chapter-illustrations.css` 仅保留管理工具、正文插图与大图预览，旧编辑弹窗的样式及覆盖已移除。

2026-11-06 阅读工具栏布局、目录／书签／设置的面板状态与焦点由 `pages/Reader.tsx` 和 `reader.module.css` 持有，菜单互斥复用 `hooks/useExclusiveMenu.ts` 并与主题菜单协作。`components/reader/SettingsControls.tsx` 自带 `SettingsControls.module.css`，供桌面弹层、移动 sheet 和展厅共用；分段选项与字号操作复用 Button，具名开关复用 Switch。移除阅读器页面内旧设置控件皮肤，保留原有设置键、档位与同步所有者，不增加公共层业务依赖。

2026-11-06 书内正文搜索由 `components/reader/BookSearch.tsx` 与自带 CSS Module 持有，供作品详情和阅读器复用；输入、弹窗、错误、空态与加载继续使用共享组件。命中定位由 `hooks/useReaderSearch.ts` 使用 Range／CSS Highlight 维护，不重写正文节点或段评锚点。

2026-11-06 文本与图像供应商预设共用 `pages/admin/ai/AiProviderPresets.tsx`，预设下拉复用生产 Select／SelectTrigger／SelectContent／SelectItem，移除原生下拉皮肤；宽度及连接字段网格对齐由 `ai-config.module.css` 维护，弹层、主题、尺寸和键盘语义继续归共享 Select，不新增公共业务依赖。

2026-11-06 个人中心账户安全的邮箱、Passkey 和修改密码卡片由 `pages/Profile.tsx`／`ProfileEmail.tsx` 持有业务，共用 `profile-security.module.css` 的桌面上方两列、下方通栏及窄屏顺序；标题、字段、操作区、Passkey 凭据和按需新增表单由该场景模块维护。旧 `account.module.css` 的对应列表／表单规则移除，字段、输入、按钮、加载和错误复用 FormField、Input、Button、Spinner、InlineError，无新增公共业务依赖。

2026-11-05 账户与注册的注册面板和邀请码工作区由 `pages/admin/SettingsTab.tsx` 与 `account-management.module.css` 持有；复用 Panel、PanelHeading、RadioGroup、FormField、Input、Button 和共享异步／空状态。`UserManagementPanel.tsx` 持有用户行的操作锁及密码菜单，`AccountAuditPanel.tsx` 持有审计摘要与详情，原 `styles/admin/pages/accounts.css` 仅保留账户列表和详情场景样式，移除旧注册胶囊、生成结果皮肤和重复按钮覆盖；未新增公共业务依赖。

2026-11-05 备份版本摘要、状态、当前任务与版本详情由 `pages/admin/backups/BackupVersionViews.tsx` 和 `backup-versions.module.css` 持有场景呈现；版本详情复用共享 ReadingDialog，列表表面仍归 AdminDataPanel。`BackupsTab.tsx` 持有视图、列表、任务观测与静默同步，PolicyForm／BackupSettingsForm 持有草稿和保存基线，跨分区保留挂载并按外部修订协调刷新；运行环境与演练弹窗接受分区可见性，不将场景状态引入共享层。

2026-11-05 AI 分级建议审核由 `pages/admin/ContentRatingAiReview.tsx` 与 `content-rating-ai-review.module.css` 持有模型证据、正文采样和审核确认布局；复用共享 `ReadingDialog`、`FormField` 与 UI 控件，弹窗尺寸、左对齐页头、中间滚动及底部插槽继续归共享阅读弹窗。`ContentRatingsTab.tsx` 保留建议、理由、保存与修订审核请求状态；旧审核弹窗的专属全局样式移除，不影响其他分级弹窗。

2026-11-05 站点设置由 `pages/admin/SiteSettingsTab.tsx` 与 `site-settings.module.css` 持有布局及各页独立读取状态；`SiteSettingsNavigation.tsx` 复用注册表元数据和共享 Tabs，统一六个视图与窄屏滚动。`site-settings-views.ts` 解析站点与旧 AI 设置地址，Admin 对这些地址复用同一个持久挂载的工作区；`ai/AiSettingsWorkspace.tsx` 按需加载并保留模型与参数两页的独立快照、草稿，复用实际 AiConfigPanel 与 AiParamsPanel，AiTab 仅负责创作。旧站点设置全局 CSS 退出运行时，卡片、按钮、开关、勾选、异步状态仍归共享层；内容安全仅呈现策略卡片，布局继续归 `content-policy.module.css`。共享 Tabs 首次直接定位，后续选择平移；不新增公共层业务依赖。

2026-11-05 审核页由 `pages/admin/ModerationTab.tsx` 与 `moderation.module.css` 持有筛选布局、正文摘要和来源信息；全文与原引用复用 `shared/ReadingDialog`，危险操作复用 `AdminRowActions` 及原确认流程，表格及窄屏记录复用 `AdminDataPanel`／`Table`。移除旧审核响应式文件、全局想法单元格及审核筛选皮肤，不新增公共层业务依赖。

2026-11-05 书源与追更明细的导航、筛选布局、书名与时间呈现由 `pages/admin/SourceAnalyticsTab.tsx` 和 `source-analytics.module.css` 持有，次要筛选使用共享 Popover、FormField 与 SearchSelect，结果使用 AdminStatusBadge，数据面板表面归 AdminDataPanel。透视统计拆为同场景的 `pages/admin/SourceDistribution.tsx`，四项摘要与分类内容共用书源模块 CSS，源站表格完整使用共享 AdminDataPanel 列定义及 Table 原语，跨列展开行由共享表格的 data-details 规则处理，移除旧透视卡片及明细皮肤、跨页工具栏覆盖；来源详情仍沿用所属模块样式。未新增公共组件或反向业务依赖。

2026-11-05 任务中心详情由 `pages/admin/TaskWorkspace.tsx` 及其 CSS Module 持有，共享摘要、结果、错误、时间和 ID 复制布局；抓取与 AI 页面提供真实数据及业务动作。该组合保留在后台任务场景层，不新增通用层反向依赖；其他抓取日志详情继续保留各自的完整日志与失败章节流程。

2026-11-05 阅读优先布局归入 `shared/ReadingDialog` 及其 CSS Module，集中维护标题、工具栏、正文／编辑框、辅助长文折叠和底部插槽，AI 生成内容与组件展厅直接使用同一生产实现；AI 模块只保留发布表单布局和业务状态。共享层不引用 AI、后台数据或业务接口，退出旧 AI 全局弹窗皮肤。

基于 `node scripts/check-web-components.mjs --inventory` 的清单补充阅读弹窗归属；106 个组件文件，262 个生产源码模块。使用方数量包含开发展厅，不包含测试。表格记录保留或迁移依据，不表示所有控件需要重写；组件内部页面级子组件按所属页面／工作流保留。

2026-11-05 代理设置页面的布局、诊断结果与帮助区域由 `pages/admin/scrape/proxy.module.css` 持有，字段、按钮、加载反馈和分区标题继续复用生产共享组件；移除旧代理页面样式及全局兼容选择器。

2026-11-05 AI 作品创作台的布局与创作子区样式由 `pages/admin/ai/writing-workspace.module.css` 持有，退出三份旧样式中的创作选择器。作品、起点、模式、分区导航和生成操作复用共享字段、SearchSelect、Tabs 与 Button；审阅及产出复用 `AiGenerationsPanel`，任务结束通过刷新标记更新列表，保留正在编辑的草稿。未新增公共组件或改变公共层依赖方向。

由 `node scripts/check-web-components.mjs --inventory` 从当前源码生成；108 个组件文件，275 个生产源码模块。使用方数量包含开发展厅，不包含测试。表格记录保留或迁移依据，不表示所有控件需要重写；组件内部页面级子组件按所属页面／工作流保留。

| 文件 | 层级 | 使用方 | 样式所有权 | 结论 |
| --- | --- | ---: | --- | --- |
| `components/AccountMenu.tsx` | 应用／业务 | 1 | `styles/account-menu.css` | 保留：账户导航与会话动作 |
| `components/admin/AdminContentRatingBadge.tsx` | 后台场景 | 5 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminDataPanel.tsx` | 后台场景 | 20 | `styles/admin/components/readability.css`、`styles/admin/components/table-motion.css`、`styles/admin/components/tables.css`、`components/admin/admin-data-panel.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminFloatingDock.tsx` | 后台场景 | 8 | `styles/admin/components/floating-dock.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminModelTime.tsx` | 后台场景 | 1 | `components/admin/AdminModelTime.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminPage.tsx` | 后台场景 | 17 | `components/admin/admin-page.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminRowActions.tsx` | 后台场景 | 7 | `styles/admin/components/row-actions.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminSelectionBar.tsx` | 后台场景 | 7 | `styles/admin/components/selection.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminStatusBadge.tsx` | 后台场景 | 39 | `styles/admin/components/status-badges.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminTabHeader.tsx` | 后台场景 | 1 | `components/admin/admin-page.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/AdminToolbar.tsx` | 后台场景 | 14 | `components/admin/AdminToolbar.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BatchNovelFollowupDialog.tsx` | 后台场景 | 2 | `styles/admin/pages/novel-followup.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BookImportChapterResolver.tsx` | 后台场景 | 1 | `styles/input-fields.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
| `components/admin/BookImportDialog.tsx` | 后台场景 | 2 | `styles/input-fields.css`、`components/admin/BookImportDialog.module.css` | 保留／拆分：管理操作、数据表面或具体作品流程 |
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
| `components/AdultUnlockDialog.tsx` | 应用／业务 | 1 | `styles/content-policy.css`、`styles/input-fields.css`、`styles/adult-unlock-dialog.css` | 保留：内容策略验证流程 |
| `components/AppErrorBoundary.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：应用异常与整页恢复 |
| `components/CatchupRecap.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：小说阅读回顾业务 |
| `components/ContentPolicyStatus.tsx` | 应用／业务 | 2 | `styles/content-policy.css` | 保留：内容访问检查状态 |
| `components/ContentRestrictionNotice.tsx` | 应用／业务 | 3 | `styles/content-policy.css` | 保留：分级门禁与解锁入口 |
| `components/feedback.tsx` | 应用／业务 | 46 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：应用级确认与通知上下文 |
| `components/icons.tsx` | 应用／业务 | 6 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：共享 SVG 图形，不包含业务状态 |
| `components/identity/UserAvatar.tsx` | 业务适配 | 10 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：账户资源地址与基础头像呈现分离 |
| `components/Layout.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：路由布局与页面外壳适配 |
| `components/NovelCard.tsx` | 应用／业务 | 2 | `components/novel-card.module.css` | 保留：小说目录与阅读/收藏状态 |
| `components/NovelCoverStatus.tsx` | 应用／业务 | 2 | `styles/novel-indicators.css` | 保留：小说封面业务标记 |
| `components/PageSeo.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：路由 SEO 与品牌配置 |
| `components/PageState.tsx` | 应用／业务 | 7 | `styles/page-state.css` | 保留：控制整页外壳的异常呈现，区别于面板空态 |
| `components/reader/BookmarkPanel.tsx` | 阅读场景 | 1 | `components/reader/BookmarkPanel.module.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/BookSearch.tsx` | 阅读场景 | 2 | `components/reader/BookSearch.module.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ChapterIllustrations.tsx` | 阅读场景 | 2 | `styles/select-fields.css`、`styles/input-fields.css`、`styles/chapter-illustrations.css`、`components/reader/ChapterIllustrations.module.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ChapterRecap.tsx` | 阅读场景 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/MobileSheets.tsx` | 阅读场景 | 1 | `styles/input-fields.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/SettingsControls.tsx` | 阅读场景 | 3 | `components/reader/SettingsControls.module.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ThoughtImage.tsx` | 阅读场景 | 2 | `styles/thoughts.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/ThoughtPanel.tsx` | 阅读场景 | 1 | `styles/thoughts.css`、`styles/input-fields.css` | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/reader/VirtualList.tsx` | 阅读场景 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：阅读状态、虚拟化、图片、触摸或阅读设置契约 |
| `components/ReadingDataPanel.tsx` | 应用／业务 | 1 | `styles/input-fields.css` | 保留：账户阅读数据检查与恢复 |
| `components/ReadingStatsPanel.tsx` | 应用／业务 | 1 | `styles/select-fields.css`、`styles/input-fields.css` | 保留：账户阅读统计 |
| `components/RouteLoading.tsx` | 应用／业务 | 3 | `styles/loading-indicators.css`、`styles/route-loading.css` | 保留：路由切换与外壳占位 |
| `components/SecurityChallengeDialog.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：账号操作的统一人机验证 |
| `components/shared/AsyncStates.tsx` | 通用组合 | 37 | `styles/loading-indicators.css`、`components/shared/AsyncStates.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/CellText.tsx` | 通用组合 | 2 | `components/shared/CellText.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/ConfirmationDialog.tsx` | 通用组合 | 2 | `components/shared/ConfirmationDialog.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/DialogFrame.tsx` | 通用组合 | 30 | `components/shared/DialogFrame.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/EmptyState.tsx` | 通用组合 | 26 | `components/shared/EmptyState.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/FloatingPageTools.tsx` | 通用组合 | 2 | `components/shared/FloatingPageTools.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/FormField.tsx` | 通用组合 | 29 | `components/shared/FormField.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/Pagination.tsx` | 通用组合 | 21 | `components/shared/Pagination.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/PaginationPageSize.tsx` | 通用组合 | 1 | `components/shared/Pagination.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/PanelHeading.tsx` | 通用组合 | 10 | `components/shared/PanelHeading.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/ReadingDialog.tsx` | 通用组合 | 7 | `components/shared/ReadingDialog.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/SearchField.tsx` | 通用组合 | 16 | `components/shared/SearchField.module.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/SearchSelect.tsx` | 通用组合 | 33 | `styles/select-fields.css`、`components/shared/SearchSelect.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/shared/TimeField.tsx` | 通用组合 | 2 | `components/shared/TimeField.css` | 迁移／共享：无业务取数，使用方提供状态与动作 |
| `components/SiteBrandingSync.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：站点品牌同步 |
| `components/SiteNotice.tsx` | 应用／业务 | 1 | `styles/site-notice.css` | 保留：站点公告与工作区位置 |
| `components/ThemeMenu.tsx` | 应用／业务 | 3 | `styles/theme-menu.css`、`styles/input-fields.css` | 保留：应用主题偏好入口 |
| `components/TurnstileTestWidget.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：站点验证码配置诊断 |
| `components/ui/alert-dialog.tsx` | 基础控件 | 2 | `components/ui/overlay-motion.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/alert.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/avatar.tsx` | 基础控件 | 1 | `styles/identity.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/badge.tsx` | 基础控件 | 12 | `styles/identity.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/button.tsx` | 基础控件 | 114 | `components/ui/button.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/card.tsx` | 基础控件 | 15 | `components/ui/card.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/checkbox.tsx` | 基础控件 | 20 | `components/ui/checkbox.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/collapsible.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/command.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/control-appearance.tsx` | 基础控件 | 9 | `components/ui/control-appearance.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/dialog.tsx` | 基础控件 | 38 | `components/ui/overlay-motion.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/dropdown-menu.tsx` | 基础控件 | 8 | `components/ui/overlay-motion.module.css`、`styles/dropdown-menu.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/field-context.tsx` | 基础控件 | 6 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/filter-chip.tsx` | 基础控件 | 2 | `components/ui/filter-chip.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/initial-avatar.tsx` | 基础控件 | 2 | `styles/identity.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/input.tsx` | 基础控件 | 49 | `styles/native-form-fields.css`、`styles/input-fields.css`、`components/ui/input.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/label.tsx` | 基础控件 | 23 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/motion.tsx` | 基础控件 | 54 | `components/ui/motion.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/panel.tsx` | 基础控件 | 8 | `components/ui/panel.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/popover.tsx` | 基础控件 | 4 | `components/ui/overlay-motion.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/progress.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/radio-group.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/scroll-area.tsx` | 基础控件 | 3 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/select.tsx` | 基础控件 | 9 | `components/ui/overlay-motion.module.css`、`styles/native-form-fields.css`、`styles/select-fields.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/separator.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/sheet.tsx` | 基础控件 | 2 | `components/ui/overlay-motion.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/sidebar.tsx` | 基础控件 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/skeleton.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/sonner.tsx` | 基础控件 | 1 | `styles/toast-feedback.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/spinner.tsx` | 基础控件 | 21 | `components/ui/spinner.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/switch.tsx` | 基础控件 | 10 | `components/ui/switch.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/table.tsx` | 基础控件 | 19 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/tabs.tsx` | 基础控件 | 21 | `components/ui/tabs.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/textarea.tsx` | 基础控件 | 22 | `styles/native-form-fields.css`、`styles/input-fields.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/toggle-group.tsx` | 基础控件 | 2 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/toggle.tsx` | 基础控件 | 2 | `components/ui/toggle.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/ui/tooltip.tsx` | 基础控件 | 3 | `components/ui/overlay-motion.module.css` | 保留：Radix/原生控件及纯视觉基础；主题和外观 context 属于设计基础 |
| `components/VisitTracker.tsx` | 应用／业务 | 1 | 组合已带样式的原语／模块内工具类；场景布局由所属入口加载 | 保留：访问统计副作用 |
| `components/workspace/NovelWorkspaceLinks.tsx` | 工作区场景 | 1 | `components/workspace/novel-workspace-links.module.css` | 保留：共享外壳或作品上下文导航 |
| `components/workspace/WorkspaceShell.tsx` | 工作区场景 | 2 | `styles/input-fields.css`、`styles/site-branding.css`、`components/workspace/workspace-shell.module.css` | 保留：共享外壳或作品上下文导航 |
