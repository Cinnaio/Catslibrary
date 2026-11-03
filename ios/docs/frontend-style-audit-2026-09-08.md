# 知舟 iOS 前端样式审计

日期：2026-09-08。

源码基准：`7f4d32afb1d6a321f621f18b440bfed27627e117`。

范围：`ZhiZhou/Views` 全部 49 个 Swift 文件的样式与布局扫描（通用/用户端 20 个、管理端 29 个），对共享层和主要流程逐段检查，并覆盖文件内的编辑、选择、预览 sheet。另检查主题、操作反馈、图片占位和应用壳层。文件数量不等于独立页面数量。

方法：当前源码审计，加上已有历史截图参照。本轮查看的截图来自构建 `34170460939`，对应 `5d0a94c`，包括 phone/tablet 和 light/dark；该次运行未全部通过，截图只作视觉参照。当前 HEAD 没有重新渲染或运行真机测试。本轮没有修改 App 源码，也没有启动双设备 UI Actions。

## 结论

当前 App 具备 Apple 原生基础：`TabView`、`NavigationStack`/`NavigationSplitView`、SF Symbols、系统 `List`/`Form`、系统材质、Dynamic Type 和 Reduce Motion/Transparency 支持都已经存在。[Theme.swift](E:/Developments/Projects/zhi-zhou-ios/ZhiZhou/Theme/Theme.swift:39) 集中维护了品牌色、系统语义色、状态色、圆角、阴影和输入框焦点样式。原生框架选择合适，跨页面视觉一致性仍需整理。

视觉问题集中在“页面契约”没有统一，而不是某个颜色值单独难看：`我的`当前是无卡片的 `.plain` 列表和 `systemBackground`（`ProfileView.swift:97-101`），发现页有渐变主卡（`HomeView.swift:252-320`），书架和存储使用 `.insetGrouped`（`BookshelfView.swift:102-107`、`StorageManagerView.swift:107-109`），离线页的行使用毛玻璃（`OfflineReadingView.swift:98-104`），后台入口和后台总览又使用白色圆角面板（`AdminRootView.swift:91-102`、`AdminDashboardView.swift:244-255`）。用户从一个入口切换到另一个入口时，会感觉像进入了不同产品。

建议以当前“我的”的克制程度为基准，统一成轻量原生阅读应用：功能导航和浏览页使用连续列表；可编辑设置采用系统分组表单；阅读正文保留独立纸面。应用壳层、文字层级、图标、行布局、分隔线和反馈共用规则。保留继续阅读的单一主入口和真实封面，弱化它的渐变/描边；玻璃集中用于浮动控制。

`.plain` 与 `.insetGrouped`、书名宋体与 UI 系统字体、阅读纸面与应用背景可以按用途并存。仅仅使用不同组件不构成缺陷；需要消除的是同类内容各自决定颜色、材质、密度和状态表达。

## 优先级发现

本报告按样式整改顺序分级：P1 是需要优先确立的全局规则，P2 是页面/控件不一致与可用性问题，P3 是可选收敛。样式整改优先级不等于功能故障等级；本轮没有确认阻断操作的 P0 问题。

### P1：同类页面没有统一表面层级

- **位置**：`ProfileView.swift:97-101`、`ProfileSettingsViews.swift:63-69` 对比 `ProfileSettingsViews.swift:116-120, 162-166`；`BookshelfView.swift:102-107`；`AdminRootView.swift:99-102`；`AdminDashboardView.swift:77-79`。
- **影响**：功能导航和内容列表有的全屏平铺、有的分组包裹；总览把整个 section 做成带阴影的面板。跨 Tab 的背景、分隔线起点和内容密度缺少统一依据，当前“我的”的轻量化没有延伸到其他页面。
- **建议**：在主题层定义功能导航/内容浏览、编辑设置、阅读正文三种页面规则。功能导航和浏览列表统一画布与连续行，系统表单按信息组分段。先完成三个主 Tab 和后台入口，再沿各自流程迁移。

### P1：卡片、渐变和材质没有清晰的使用边界

- **位置**：发现页继续阅读卡 `HomeView.swift:252-320` 使用 20pt 渐变卡；后台总览 `AdminDashboardView.swift:244-255` 使用 14pt 表面、描边和阴影；候选封面 `AdminAICoverView.swift:544-640` 使用 `paperCard()`；离线行 `OfflineReadingView.swift:98` 使用 `.thinMaterial`。
- **影响**：圆角、阴影、描边和透明度同时出现，内容行、操作行、状态行难以区分主次；在 iPad 宽屏上白色面板的视觉重量尤其明显。
- **建议**：主阅读入口靠封面、书名和进度形成层级，弱化渐变、描边。后台总览用分组内容和分隔线；普通离线行改用实色表面。候选封面是独立结果项，保留必要的框定合理，且当前已经清除了外层 List 行底色，不应误报为卡片嵌套。系统材质用于浮动控制，不推广到普通内容行。

### P1：同一种选择/筛选操作有多套控件语言

- **位置**：`ReaderSettingsView.swift:140-215` 使用 `GlassEffectContainer` 加玻璃胶囊；管理端筛选使用 `AdminFilterMenu` 的薄材质胶囊（`AdminComponents.swift:157-214`）；管理端其他页面使用 `accessibleSegmentedPicker()`（`AdminComponents.swift:89-117`）。
- **影响**：用户对“可选项”“当前选中”“筛选菜单”的视觉预期无法迁移；玻璃控件也会与普通 `Form` 控件形成两种交互重量。
- **建议**：复用现有 `accessibleSegmentedPicker()` 的策略：短互斥选项使用系统 segmented，长选项或大字体降级为 Menu/纵向选项。筛选菜单保留原生 Menu，统一其轻量外观。通过小型共享样式统一状态与 44pt 触控区，无需另造通用控件框架。

### P2：元信息的字号、明度和目录行密度没有统一规则

- **位置**：发现页的阅读进度使用 `.caption + textMuted`（`HomeView.swift:282-292`），书籍状态/章节数/更新时间也使用 `textMuted`（`NovelCardView.swift:27-41`），详情元信息则用 `textSecondary`（`NovelDetailView.swift:580-584`）。详情目录标题使用 `.body` 并支持大字体不限行（`NovelDetailView.swift:345-349`），目录 sheet 使用 `.subheadline + lineLimit(2)`（`ChapterListView.swift:49-52`）。
- **影响**：有用的阅读进度和书籍元信息在部分页面被弱化得接近装饰文字；同一目录在两个入口的字重/密度和大字体策略不同。已有截图显示浅色元信息偏淡，但本轮没有测量当前设备对比度，不能声称对比度测试失败。
- **建议**：书名、作者、元信息、章节行分别约定字体角色，关键元信息默认 secondary，tertiary 留给可忽略的辅助内容；目录行采用一个基础排版并按页面空间切换明确的紧凑变体。
- **排除误报**：详情书名的 `bookTitleSize` 已由 `@ScaledMetric(relativeTo: .title2)` 缩放（`NovelDetailView.swift:14`），不能因为调用 `SongtiFont.font(size:)` 就说它不支持 Dynamic Type。5/9pt 的小符号是状态标记，不是正文文本；书名宋体和 UI 系统字体的分工可保留。

### P2：品牌标记和图标槽位尚未形成组件契约

- **位置**：`RootView.swift:22-58` 的 `BrandMark` 为 76pt 深色渐变方块；`LoginView.swift:95-110` 另做 48pt 浅色图标块；`ProfileView.swift:143-168` 的设置图标固定在 24pt 槽位，而管理后台直接使用原生 `Label`（`AdminRootView.swift:157-163`）。
- **影响**：启动、登录、关于页面的品牌识别尺寸和材质不同；用户端与后台的图标对齐基线也不完全可预测。
- **建议**：保留一套 `BrandMark(size: emphasis:)` 和一套 `AppIconLabel`。图标槽位固定 24pt、可缩放图形约 18-20pt，文字从同一行高 token 开始；颜色只使用品牌强调色或语义状态色，避免页面各自决定渲染模式。

### P2：操作完成反馈没有统一到全局反馈中心

- **位置**：`AppFeedback.swift:70-102` 已提供触觉加可读 banner；账户、书架和离线操作会调用 `AppFeedback`，但站点公告保存只调用 `UINotificationFeedbackGenerator`（`AdminAnnouncementView.swift:95-105`），部分后台保存只显示局部 `saveMessage`。
- **影响**：同样的保存动作，有的页面出现可读提示，有的页面只能靠按钮恢复或触觉推断结果；关闭触觉或使用辅助功能时状态更不明确。
- **建议**：成功、失败、进行中统一使用 `AppFeedbackCenter` 或共享行内状态组件；保存按钮、进度指示器和成功文案采用相同的位置、颜色和持续时间。

### P2：单项编辑页的保存位置和标题层级不一致

- **位置**：[个人资料](E:/Developments/Projects/zhi-zhou-ios/ZhiZhou/Views/ProfileEditView.swift:68) 使用 inline 标题、工具栏保存；[站点公告](E:/Developments/Projects/zhi-zhou-ios/ZhiZhou/Views/Admin/AdminAnnouncementView.swift:37) 把保存放在编辑区下方，并使用 large 标题；[运行参数](E:/Developments/Projects/zhi-zhou-ios/ZhiZhou/Views/Admin/AdminAISettingsView.swift:138) 把“保存全部参数”放在长列表底部，也使用 large 标题。
- **影响**：用户进入新的编辑页需要重新寻找提交入口；深层配置页与模块首页同样采用大标题，导航层级不够明确。
- **建议**：模块首页 large，单项编辑与详情 inline；整页保存使用工具栏 confirmationAction。供应商等可以独立保存的分组，保留就近的分组操作，避免改变保存范围。

### P2：段评辅助操作的明确触控区低于全局约定

- **位置**：`ReaderView.swift:360-375` 的段评按钮只设置 `frame(minHeight: 28)`；`ThoughtPanelView.swift:180-182` 的重试按钮使用玻璃样式但没有明确的最小尺寸。
- **影响**：正文阅读场景中，细小的胶囊和重试入口更难点按，也不符合 iOS 44pt 触控目标原则。
- **建议**：视觉标签可以保持紧凑，但外层 Button 至少提供 44pt 高度和足够横向命中区；给 VoiceOver 一个完整动作标签，避免扩大命中区后出现重复可访问元素。

### P2：阅读上下文的纸面没有完整传递到段评底部

- **位置**：从“我的”打开阅读设置时固定使用 `AppTheme.background`（`ProfileView.swift:105-109`），从阅读器打开时使用当前纸面 `paper`（`ReaderView.swift:224-229`）；段评面板内容透明，但底部 composer 固定 `AppTheme.background`（`ThoughtPanelView.swift:63-85, 387-395`）。
- **影响**：段评面板在护眼/羊皮纸面下，上部继承纸面、底部输入区使用分组背景，存在色块断层。具体视觉需在这两个纸面下确认。从“我的”和阅读器进入设置时使用不同背景可以是合理的上下文设计，应明确这条例外。
- **建议**：确定阅读附属面板统一采用系统表面还是继承纸面，面板及输入区完整采用同一种规则。保留从“我的”进入时的系统外观，避免把阅读偏好扩展成全 App 主题。

### P2：状态色的语义入口不完全统一

- **位置**：大部分页面使用 `AppTheme.success/warning/danger`，但章节管理仍直接使用 `.orange`（`AdminChaptersView.swift:388-391, 575, 643`），存储错误直接使用 `.red`（`StorageManagerView.swift:58-62`），POPO 表单也直接使用 `.red/.orange`（`Po18AccountSheet.swift:35, 67`）。
- **影响**：同一类警告使用两套色值，后台状态标签与普通表单状态不一致。系统 `.red/.orange` 本身支持外观变化，这里是项目语义色使用不一致，不能直接认定深色模式损坏。
- **建议**：把所有“警告/错误/成功/未检测”映射到 `AppTheme` 语义色；仅保留阅读纸面色板的固定 swatch（`ReaderSettingsView.swift:10-14`）作为用户可选内容色。

### P2：宽屏和大字体的适配规则覆盖不均

- **已做得较好**：发现、书架、详情、阅读器有 `NavigationSplitView` 或最大内容宽度；Profile 和 ReaderSettings 已对 accessibility Dynamic Type 使用 `AnyLayout`/纵向布局（`ProfileView.swift:136-140`、`ReaderSettingsView.swift:134-138, 219-223`）。历史前端审计的 phone/tablet、light/dark 和 XXXL 场景也曾通过。
- **风险位置**：后台封面生成的双按钮使用 `lineLimit(1)` 和 `minimumScaleFactor(0.82)`（`AdminAICoverView.swift:366-403`）；运行参数行把数值输入限制在 120pt（`AdminAISettingsView.swift:281-307`）；后台多处列表元数据使用 `lineLimit(1)`，缺少统一的 accessibility 断行策略。
- **建议**：建立 `compact/regular/accessibility` 三档布局规则，优先换行和纵向堆叠，最后才缩小文字；验收 iPhone SE/窄 Split View、iPad 横竖屏、XXXL、键盘出现和深色高对比。

### P3：离线阅读有一个可选收敛的上下文入口

- **位置**：`ProfileView.swift:41-55` 的“离线阅读”直接进入 `OfflineReadingView`；`StorageManagerView.swift:88-97` 又提供“管理离线章节”进入同一页面。
- **影响**：两个入口的目标相同，但在查看存储时直接进入离线管理也有合理用途，不能仅凭重复路由判定为冗余功能。
- **建议**：继续以“我的 → 离线阅读”为主入口；存储中的入口可随离线占用摘要呈现，或在精简信息架构时删除。当前主页面已去掉最近阅读/继续阅读等重复项，不建议为减少入口而隐藏常用管理功能。

## 覆盖矩阵

| 页面族 | 已审查文件 | 当前共同规则 | 统一方向 |
|---|---|---|---|
| 应用壳层与登录 | `RootView`、`LoginView`、`ZhiZhouApp` | 原生 Tab/导航、独立品牌头、全局反馈 | 统一品牌标记、标题和全局反馈层 |
| 发现与书架 | `HomeView`、`BookshelfView`、`NovelCardView`、`NovelDetailView`、`ChapterListView` | 自绘 ScrollView、List、渐变主卡、玻璃行动条并存 | 连续内容行 + 单一主行动表面 |
| 离线与阅读 | `OfflineReadingView`、`ReaderView`、`ReaderSettingsView`、`ThoughtPanelView`、`SelectableTextView` | 阅读纸面独立，控制条/设置大量材质 | 纸面作为上下文主题，控制 primitive 共用 |
| 我的与账户 | `ProfileView`、`ProfileSettingsViews`、`ProfileEditView`、`ChangePasswordView`、`PrivacyNoticeView`、`StorageManagerView` | Profile 平铺，子页分组 Form/List，有离线上下文入口 | 功能导航保留平铺，编辑页原生表单，统一各自页面规则 |
| 后台入口与总览 | `AdminRootView`、`AdminDashboardView`、`AdminComponents` | 分组白面板、状态 badge、横向筛选胶囊 | 共享列表行、筛选、状态和面板 primitive |
| 后台 AI | `AdminAIServiceView`、`AdminAIProviderView`、`AdminAISettingsView`、`AdminAIStatusView`、`AdminAIUsageView`、`AdminAITasksView`、`AdminAITaskProgressView`、`AdminAIWritingView`、`AdminAICoverView`、`AdminAIGenerationsView` | 原生 Form/List、输入 surface、候选卡、玻璃/边框按钮混用 | 表单和结果预览分层，统一操作状态 |
| 后台内容与采集 | `AdminNovelsView`、`AdminChaptersView`、`AdminModerationView`、`AdminDiscoverView`、`AdminJobsView`、`AdminScrapeCenterView`、`AdminScrapeConfigsView`、`AdminScrapeSourcesView` | 多个筛选条、状态色、详情 sheet | 统一筛选条、列表密度和语义状态 |
| 后台系统 | `AdminProxyView`、`AdminSiteOperationsView`、`AdminMobileTelemetryView`、`AdminUsersView`、`AdminLoginAuditView`、`AdminPolicyView`、`AdminAnnouncementView`、`Po18AccountSheet` | 监控表格/指标、表单、sheet 各自设置反馈和宽度 | 保留信息密度，统一标题层级、输入、保存和错误状态 |

共享辅助文件还包括 `LoadErrorNotice.swift` 和 `KeyboardDismissal.swift`；键盘桥接没有独立视觉样式。`CachedAsyncImage` 已有按目标尺寸缓存/解码及重试占位，`SelectableTextView` 保留系统选区与编辑菜单；本轮不据此评价滚动帧率或整体性能。

## 建议的视觉契约

1. **背景**：功能导航和内容浏览使用 `systemBackground` 语义画布；编辑设置使用 `systemGroupedBackground` 和系统分组表面；阅读使用用户纸面。由主题按页面类型提供，替代当前单一的 `pageBackground()` 和页面散写背景。
2. **层级**：普通行和页面 section 无自绘阴影；独立预览项可以有单层边界；采用 8/12/16/24 的主要间距档位。系统 Form/List 圆角由系统管理，自定义小表面沿用现有 token 并收敛例外。
3. **文字**：系统 `Font.TextStyle` 负责 UI；宋体保留在书名和阅读内容；主要信息在大字体时换行，数字按需要使用 `monospacedDigit()`。
4. **图标**：SF Symbols 单色为默认，功能导航图标统一 secondary，操作和选中态使用品牌色，状态使用语义色；默认图标槽位 24pt，独立控件命中区至少 44pt。放大图形时同时处理槽位上限，避免重现之前的图标溢出。
5. **控件**：短互斥选项 segmented，较多选项 Menu；原生 Form 保留原生输入行，自定义独立输入区使用 `appFieldSurface`。正文中的主动作统一品牌强调，工具条采用系统控件；玻璃限定在浮动交互层。
6. **反馈**：加载、成功、失败、禁用和未保存状态采用共享规则，并提供可访问文案。保留现有 Reduce Motion/Transparency 支持；自定义色和材质的高对比表现列入真机验证，不声称已覆盖。
7. **导航**：根页 large title，详情/编辑页 inline；sheet 的背景、drag indicator、关闭/完成位置遵循同一个规则。

## 分阶段实施顺序

1. **P1 基础层**：在 `Theme.swift` 增加页面/文本/行/图标/控件 token 和 primitive，先让 Profile、Bookshelf、Home、AdminRoot、AdminDashboard 使用相同契约。
2. **P1 控件规则**：收敛 ReaderSettings、AdminFilter 和表单的选择/输入/主按钮，统一标题和保存位置；Storage 的上下文入口单独作为可选的信息架构决策。
3. **P2 阅读上下文**：统一 ReaderSettings、ChapterList、ThoughtPanel 的面板表面规则，处理 composer 与纸面的分层；补齐 44pt 命中区。
4. **P2 后台迁移**：按 AI、内容采集、系统三组逐页迁移，不在单个页面继续增加新的卡片或颜色例外。
5. **验收**：在当前 HEAD 上人工检查 iPhone 窄屏、iPad Split View、横竖屏、light/dark、XXXL、Reduce Motion/Transparency 和键盘状态；继续使用现有 Core/Release 构建验证代码契约，但不把 CI 结果当作设备视觉验收。

## 保留项与边界

- 原生 TabView、导航分栏、系统 List/Form、SF Symbols、动态字体入口、缓存图片组件和全局反馈中心应继续保留，它们是统一风格的基础。
- 阅读纸面（系统/护眼/羊皮）是内容偏好，不应被应用层的绿色品牌色或系统分组背景覆盖。
- 现有历史截图能证明部分旧构建的布局路径，但不能证明当前 Profile 改动后的最终视觉，也不能证明真实设备上的对比度、触控和旋转体验。

## 批准后的实施结果

用户批准全量实施后，以上 P1、P2 与 P3 建议已落实到本地源码。以下记录描述本轮实现，不改变前面的历史审计结论。

### 已完成

| 审计项 | 实施结果 |
|---|---|
| 页面表面 | `AppPageStyle` 明确区分 browsing/settings；所有浏览列表使用系统画布与连续行，编辑页使用原生分组表面。宽屏浏览列表通过共享规则限制阅读宽度；Profile 和详情继续使用自己的居中行边距，避免重复收窄。 |
| 卡片与材质 | 继续阅读移除渐变及外框，总览 section 改为原生行；离线书籍作为普通展开行，避免封面随 Section 标题吸顶。候选封面保留单层预览边界，移除共享卡片阴影；玻璃只用于浮动阅读控制、图片预览关闭等浮层。 |
| 选择控件 | 阅读设置改为原生 Form、Stepper、Picker；共享 segmented 在 XXXL 及以上改为 Menu，纸面保留色板和可访问选中态。后台筛选保留 Menu，采用轻量实色表面，大字体可纵向排列。 |
| 文字与目录 | 发现、书架、离线与后台关键元信息使用 secondary；统一书名层级与封面规格。详情、阅读目录、离线目录和后台章节共用章节文字规则，辅助功能字号允许完整换行。 |
| 品牌与图标 | 启动、登录、关于复用同一个 BrandMark；我的、账户和后台导航使用 AppIconLabel，图形限制在 24pt 槽位内。登录采用与全 App 一致的品牌实色主按钮和输入表面。 |
| 保存与反馈 | 公告与运行参数的整页保存放在 confirmationAction 工具栏，标题 inline；保存期间禁用编辑并显示进度。供应商保留文本/图像独立保存；公告、参数、供应商和代理保存共用 AppFeedback。反馈支持 VoiceOver 播报，警告使用 warning 语义色。 |
| 触控与大字体 | 段评、重试、图片关闭及共享玻璃控件明确提供至少 44pt 的触控区。封面操作、大字体元信息、数值输入采用换行或纵向布局；大字体阅读面板优先完整高度。段评在辅助功能字号下把输入区放入可滚动内容，避免底部固定输入区占满可用高度。 |
| 阅读纸面 | 正文继续使用 ReaderSettingsStore 的用户纸面与排版；目录和段评统一系统语义画布，段评输入区与内容同色；设置面板使用分组表面。8 项阅读偏好的原有存储键和即时更新方式保持兼容。 |
| 状态色 | 章节管理、存储和 POPO 表单的警告/失败统一到 AppTheme；未配置状态使用 secondary。减少透明度或提高对比度时，共享材质控件使用有实色底层的回退表面。 |
| 入口收敛 | 存储中的离线管理入口合并到“已下载章节”摘要行；“我的 → 离线阅读”保留为主入口。 |

本轮覆盖全部页面族；`SelectableTextView` 与 `KeyboardDismissal` 沿用既有系统文字选择和键盘桥接。没有改动 API、后台危险操作确认模型、正文缓存和阅读进度恢复机制，也没有改动既有的 `docs/home-discovery-preview.html`。

### 已执行验证

- `scripts/reader-smoke.ps1`：通过，保护滚动渲染、章节恢复和稳定系统控制区。
- `scripts/navigation-smoke.ps1`：通过，保护发现、书架、详情、阅读与离线下载入口。
- `scripts/admin-operation-smoke.ps1`：通过，保护危险操作确认、操作 ID 与目标快照。
- `scripts/image-cache-smoke.ps1`：通过，保护图片缓存、请求合并和取消后的更新边界。
- `git diff --check`：通过。
- 使用临时安装的 Tree-sitter Swift 解析器对 `ZhiZhou` 下 78 个 Swift 文件与审计 HEAD 做对比，没有新增解析诊断。部分既有 Swift 语法不被该解析器完整支持，因此这是补充检查，不等于 Swift 编译或类型检查；解析器没有加入项目依赖。

### 验收边界

本机是 Windows，没有 Swift/Xcode/iOS 模拟器。截至提交前，没有执行本轮改动的原生构建、生成新的 IPA 或拍摄改动后的设备截图；历史构建和截图不能用于证明本轮效果。推送后按精确提交 SHA 核对常规 Core 测试、Release 构建和 IPA。遵循用户偏好，不启动双设备测试 Action；设备视觉效果由人工验收。

设备验收重点：三个 Tab 的背景与行密度；iPad 和窄 Split View；light/dark、XXXL 和辅助功能字号；Reduce Motion/Transparency 与增强对比度；8 项阅读设置同步、护眼/羊皮正文下打开目录和段评；段评键盘与发布；离线展开、多选、删除与阅读；整页保存和供应商分组保存。保存后应有明确可读反馈，返回阅读时正文纸面和进度应保持。
