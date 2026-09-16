# 后台子 tab 样式收口执行手册（小说 / 章节双范本）

日期：2026-09-16
仓库：`E:\Developments\Projects\zhi-zhou`
编制基线：`2e40652a28c2841ed4ca527f2c7c04659ddf0c52`（`style(admin): 统一书源批量操作栏`）
执行对象：Luna，MAX 推理强度。本文是实施任务书，不是已完成的改造记录。

## 1. 目标与授权边界

以**小说管理、章节管理**两页为唯一视觉范本，把其余后台子页面统一到同一套页头、间距、面板、工具栏、数据行、表单和弹窗语言。目标是进入不同子页面时保持一致的操作感，同时保留每个业务的工作流程。

**本版与 2026-09-13 版的关键差异**：范本由「小说 + 章节 + 审核」三页收敛为「小说 + 章节」两页；审核队列、安全策略随之成为迁移目标；编制基线由 `75e1d1b` 推进到 `2e40652`，其间已有 13 个后台样式收口提交落地，其成果计入基线、不再重复要求；表格契约类名、列宽上限、断点等旧描述按当前源码勘误（见 §2.3）。

编制时仅检查源代码、路由、组件和样式，未打开已登录后台逐页做视觉验收，未执行构建或运行时测试。下文「现状」指源码证据，「目标」与「验收」指后续执行要求。

执行时的范围：

- 修改 `web/src/pages/admin/` 中本文指定页面及它们实际使用的展示组件。
- 按需扩展 `web/src/components/admin/` 与后台作用域 CSS；保留 React、Radix/shadcn、现有图标、图表、反馈组件体系。
- 保留 API 调用、请求参数、状态含义、分页方式、筛选条件、权限判断、保存时机、轮询节奏、确认流程和深链。
- 两个范本作为固定对照；除修复必要的共享组件兼容问题外，不重新设计范本。
- 默认不改 API、数据库、提示词、模型参数值、依赖、版本、公共阅读页和全局导航结构。不顺手修与样式无关的业务问题。
- 默认不提交、不推送、不部署；不创建新任务、不调用其他代理。用户另行明确要求时再执行对应动作。

**完成定义：25 个可导航页面全部有实施记录与验收状态，其中 23 个迁移目标逐项收口、T24/T25 作为范本完成回归；共享组件变更未破坏两个范本；静态检查通过；实际浏览器可验证的状态有证据。缺少登录或测试数据时应列为待验收，不能把「编译成功」写成「全部完成」。**

## 2. 首次执行：先读什么

从项目根目录开始，先检查适用的 `AGENTS.md`、工作区状态和当前提交。本文中的行号会变化，定位优先用文件与符号。

```powershell
git status --short
git rev-parse HEAD
rg --files -g AGENTS.md
```

`rg --files -g AGENTS.md` 在编制基线下的结果只有 `node_modules/recharts/AGENTS.md`，不属于本项目规则；仓库根目录与后台目录没有 `AGENTS.md`。提交信息遵循 `.cursor/rules/commit-language.mdc`：Conventional Commits 英文 type + 中文描述。

继续读这些文件，避免仅凭文件名猜实现：

| 顺序 | 文件 | 需要理解的内容 |
| --- | --- | --- |
| 1 | `web/src/pages/admin/NovelsTab.tsx` | 页头搜索与新增、`NOVEL_COLUMNS`、批量操作条、排序表头、行操作、编辑弹窗 |
| 2 | `web/src/pages/admin/ChaptersTab.tsx` | 工作对象选择、目录面板、`CHAPTER_COLUMNS`、两种空状态、编辑与融合标题弹窗 |
| 3 | `web/src/components/admin/AdminWorkspace.tsx` | `AdminDataPanel`/`AdminPanelHeading`/`AdminToolbar`/`AdminSearch`/`AdminMetricStrip`/`AdminQueueSummary`/`AdminColumn` 的真实 props 与职责边界 |
| 4 | `web/src/components/admin/AdminPage.tsx`、`AdminTabHeader.tsx` | 页头归属与自动附加的容器契约 |
| 5 | `web/src/styles/admin-operations.css` | `:root` 变量、页头/工具栏/弹窗/表格卡片化，以及文件后部覆盖规则（7535 行） |
| 6 | `web/src/styles/tokens.css` | 表格契约、圆角、分段 tabs、弹窗契约等被后台消费的全局 token |
| 7 | `web/src/styles/global.css` | 样式导入顺序与 legacy 层位置 |
| 8 | `web/src/pages/admin/admin-registry.ts`、`Admin.tsx`、`AdminShell.tsx`、`AdminSidebar.tsx` | 导航契约、路由、滚动所有权；正常情况下只读 |
| 9 | `web/src/components/admin/CustomSelect.tsx`、`Pagination.tsx`、`AdminEmptyState.tsx`、`feedback.tsx` | 下拉、分页、空状态、toast/confirm |
| 10 | `PRODUCT.md`、`DESIGN.md`、`.impeccable/surfaces/web-src-pages-admin-admin-tsx.md` | 背景资料；与当前范本冲突时按下述证据优先级处理 |

证据优先级：用户指定范本 → 当前范本实际 DOM 与计算样式 → 当前共享组件与 CSS → 设计文档 → 旧注释与旧手册。不要根据旧文档重建一套外观。

### 2.1 范本的定义位置

| 范本 | 路由 | 主文件 | 关键行 | 重点借鉴 |
| --- | --- | --- | --- | --- |
| 小说管理 | `/admin/novels` | `NovelsTab.tsx` | `:469` 页头、`:492` 面板、`:495` 批量条、`:645` 弹窗 | 紧凑页头（搜索 + 主要动作）、对象列表、排序、批量操作、行操作、编辑弹窗 |
| 章节管理 | `/admin/chapters` | `ChaptersTab.tsx` | `:482` 页头、`:510` 目录面板、`:527` 面板内工具条、`:649`/`:708` 弹窗 | 工作对象选择、工作区上下文、长文本表单与大数据量弹窗 |

两个范本共享同一套骨架，差异只在工具栏位置与工作对象语义：

- 小说：页头 actions = `AdminSearch` + 主按钮；批量条在数据面板内、`AdminPanelHeading` 之下。
- 章节：页头 actions = `CustomSelect`（工作对象）+ 主按钮；搜索与批量/融合动作在面板内 `chapter-toolbar`；未选工作对象、无数据、搜索无结果三种状态分别渲染。

### 2.2 已确认的文档与实现差异

- `PRODUCT.md` 仍写「8 个后台管理 tab」，实际注册表为 5 个导航分组、9 个一级入口、25 个可导航子页（一级入口：总览、客户端监控、小说管理、章节管理、爬虫抓取、AI 服务、内容审核、站点运营、账户与注册）。不要用 `PRODUCT.md` 确定范围。
- `DESIGN.md` 的 `Admin Tab Header (AdminTabHeader)` 一节仍描述「Kicker 0.65rem uppercase、Title clamp(1.25rem~1.6rem)」；`AdminTabHeader.tsx` 实现已退役 kicker 与 hero 变体（props 保留但忽略），标题为 `text-2xl font-bold`。以组件为准。
- `.impeccable/surfaces/web-src-pages-admin-admin-tsx.md` 的 FIRST VIEWPORT 仍描述默认落在「发现」tab，且 FINISH 一节称 `_admin-discover.css` 已整体删除——该文件当前确实不存在，但 `_admin.css`、`_admin-ui.css` 仍在 `global.css:24-25` 导入。surface 契约不是范围来源。
- `AdminWorkspace.tsx:176` 的注释写「由 `.admin-data-table` 的 `table-layout: fixed` 消费」；仓库中**不存在** `.admin-data-table` 类，真实选择器是 `.admin-data-panel--grid table`（`admin-operations.css:6770`）。属过期注释，不要据此新建文件或类。
- 本章 §2.3 的三条勘误取代 2026-09-13 版手册中对应的旧数字。

这些差异只用于避免误实施，不授权重写整个设计文档。

### 2.3 旧手册勘误（按当前源码）

2026-09-13 版手册第 4.4 节有三处与当前源码不符，本版按实测更正：

| 旧表述 | 当前实测 |
| --- | --- |
| 「桌面固定列宽规则显式覆盖第 1–8 列」 | 覆盖到**第 12 列**：`admin-operations.css:6775-6822` 写 `th:nth-child(N), td:nth-child(N) { width: var(--col-N-w, auto) }`，N 至 12；第 13 列起无规则，落到 `table-layout: fixed` 的剩余宽度分配。`AdminWorkspace.tsx:177` 对**所有**列无条件生成 `--col-N-w`（仅当该列声明了 `width`） |
| 「通用卡片断点为 `900px`，不是 `640px`」结论正确，但旧手册未说明它成对出现 | 固定列宽生效区间为 `@media (min-width: 901px)`（`:6769`），卡片化为 `@media (max-width: 900px)`（`:6935`）；分界值 900/901。工具栏换行断点同为 900px（`:7131`） |
| 「`AdminColumn.label/primary/actions` 不会自动写入 TableCell」正确 | 补充：`AdminDataPanel` 仅在传入 `columns` 时添加 `--col-N-w` 变量与 `.admin-data-panel--grid`，其余渲染职责全部在调用方（`AdminWorkspace.tsx:174-184`） |

## 3. 页面范围：25 个可导航页面，2 个范本，23 个迁移目标

路由中的查询参数属于既有导航契约，不能改名。没有查询参数时，部分分组会恢复本地持久化的上次子页；验收具体页面时使用表中的完整 URL。

下表文件均相对 `web/src/pages/admin/`。页面内的编辑弹窗、展开详情、错误与空状态属于该页任务，不另计页数。

### 3.1 固定范本（回归检查，不列入迁移数量）

见 §2.1。范本自身只允许两类改动：修复共享层兼容性问题的必要调整；本轮已确认的死代码清理（见 §6 P0）。

### 3.2 迁移清单

| ID | 页面 | 路由 | 主文件 | 类型 | 执行包 |
| --- | --- | --- | --- | --- | --- |
| T01 | 内容审核（审核队列） | `/admin/moderation` | `ModerationTab.tsx` | 多条件筛选列表 | P1 |
| T02 | 安全策略 | `/admin/content-policy` | `ContentPolicyTab.tsx` | 即时保存配置 | P1 |
| T03 | 客户端监控 | `/admin/mobile-telemetry` | `MobileTelemetryTab.tsx` | 指标与事件列表 | P1 |
| T04 | 用户管理 | `/admin/settings?view=users` | `SettingsTab.tsx` | 对象列表 | P2 |
| T05 | 注册与邀请码 | `/admin/settings?view=registration` | `SettingsTab.tsx` | 配置与列表 | P2 |
| T06 | 登录审计 | `/admin/settings?view=audit` | `SettingsTab.tsx` | 筛选列表 | P2 |
| T07 | 操作审计 | `/admin/settings?view=operation-audit` | `SettingsTab.tsx` | 筛选列表 | P2 |
| T08 | 任务队列（任务管理） | `/admin/jobs` | `JobsTab.tsx` | 队列与日志 | P3 |
| T09 | AI 任务 | `/admin/ai?sub=tasks` | `ai/AiTasksPanel.tsx` | 队列列表 | P3 |
| T10 | 调用审计 | `/admin/ai?sub=audit` | `ai/AiAuditPanel.tsx` | 列表与展开详情 | P3 |
| T11 | 已生成内容 | `/admin/ai?sub=content` | `ai/AiGenerationsPanel.tsx` | 列表与审阅弹窗 | P3 |
| T12 | 抓取中心 | `/admin/scrape?view=center` | `scrape/CenterView.tsx`、`scrape/center/*` 实际使用组件 | 多步骤工作流 | P4 |
| T13 | 书源管理 | `/admin/scrape?view=sources` | `scrape/SourcesView.tsx` | 筛选列表与导入 | P4 |
| T14 | 代理设置 | `/admin/scrape?view=proxy` | `scrape/ProxyView.tsx` | 配置、检测与日志 | P4 |
| T15 | AI 创作 | `/admin/ai?sub=writing` | `ai/AiWritingPanel.tsx` | 生成工作流 | P5 |
| T16 | 封面生成 | `/admin/ai?sub=cover` | `ai/AiCoverPanel.tsx` | 生成与图片选择 | P5 |
| T17 | AI 配置 | `/admin/ai?sub=config` | `ai/AiConfigPanel.tsx` | 分组配置 | P5 |
| T18 | 参数调优 | `/admin/ai?sub=params` | `ai/AiParamsPanel.tsx` | 长表单配置 | P5 |
| T19 | 总览 | `/admin/dashboard` | `DashboardTab.tsx` | 指标与快捷入口 | P6 |
| T20 | 用量统计 | `/admin/ai?sub=usage` | `ai/AiUsagePanel.tsx` | 指标与趋势图 | P6 |
| T21 | 运营概览 | `/admin/site-operations?view=overview` | `SiteOperationsTab.tsx` | 指标与运营面板 | P6 |
| T22 | 流量分析 | `/admin/site-operations?view=traffic` | `SiteOperationsTab.tsx` | 指标与分类分析 | P6 |
| T23 | 内容分析 | `/admin/site-operations?view=content` | `SiteOperationsTab.tsx` | 指标、分布与详情 | P6 |

审核队列与安全策略在 2026-09-13 版中是范本，本轮改为迁移目标：范本只保留小说与章节。总览与客户端监控虽为一级入口，仍按「其他后台页面」纳入统一收口。

**不在本手册范围内的页面**：公共阅读页（Home / Novel / Reader / Bookshelf / Profile / Auth / Install）与其样式文件。`scrape/Po18AccountPanel.tsx` 跟随所属抓取页面检查外观，不因为有「Account」名称就搬到账户区。

### 3.3 当前实测状态矩阵

依据编制基线的逐文件核查，以下事实决定每页的真实工作量：

| 文件 | AdminPage | DataPanel | Toolbar | 列定义 | TableCell `data-*` | 原生/裸表格 | `admin-dialog` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NovelsTab.tsx`（范本） | 是 `:469` | 是 `:492` | 是 `:495` inline | `NOVEL_COLUMNS` `:35` | 1/6/1/1 | 无 | 是 |
| `ChaptersTab.tsx`（范本） | 是 `:482` | 是 `:510` | 是 `:527` inline | `CHAPTER_COLUMNS` `:34` | 1/4/1/1 | 无 | 是 |
| `ModerationTab.tsx` | 是 `:573` | 是 `:652` | 是 `:584` inline | `MODERATION_COLUMNS` `:98` 三模式 | 3/19/3/0 | 无 | 无 |
| `ContentPolicyTab.tsx` | 是 `:62` | 无 | 无 | 无 | 无 | 无 | 无 |
| `MobileTelemetryTab.tsx` | 是 `:130` | 是 `:166` | 是 `:145` inline | `MOBILE_TELEMETRY_COLUMNS` `:31` | 1/5/0/0 | 无 | 无 |
| `SettingsTab.tsx` | 是 `:436` 动态 | **无** | 是 `:598`、`:691` inline | **无** | 4/23/2/0 | **4 处裸 `Table`** `:514`、`:639`、`:721`、`:806` | 无 |
| `JobsTab.tsx` | 是 `:369` | 是 `:397`、`:466` | 无 | `JOB_COLUMNS` `:49`、`DOWNLOAD_COLUMNS` `:61` | 2/12/1/0 | 无 | 无 |
| `AiTab.tsx` | 是 `:99` 动态 | 无（下沉到面板） | 无 | 无 | 无 | 无 | 无 |
| `ai/AiTasksPanel.tsx` | 继承 | 无 | 是 `:121` | 无 | 无 | 无 | 无 |
| `ai/AiAuditPanel.tsx` | 继承 | 无 | 是 `:78` | 无 | 无 | **原生 `<table>`** `:123` | 无 |
| `ai/AiGenerationsPanel.tsx` | 继承 | 无 | 是 `:296` | 无 | 无 | **原生 `<table>`** `:352` | 无 |
| `ai/AiUsagePanel.tsx` | 继承 | 无 | 无 | 无 | 无 | 无 | 无 |
| `ai/AiConfigPanel.tsx` | 继承 | 无 | 无 | 无 | 无 | 无 | 无 |
| `ai/AiParamsPanel.tsx` | 继承 | 无 | 无 | 无 | 无 | 无 | 无 |
| `ai/AiWritingPanel.tsx` | 继承 | 无 | 无 | 无 | 无 | 无 | 无 |
| `ai/AiCoverPanel.tsx` | 继承 | 无 | 无 | 无 | 无 | 无 | 无 |
| `scrape/index.tsx` | 是 `:41` 动态 | 无 | 无 | 无 | 无 | 无 | 无 |
| `scrape/CenterView.tsx` | 继承 | 是 `:593` | 无 | 无 | 无 | 无 | 无 |
| `scrape/SourcesView.tsx` | 继承 | 是 `:394` | 是 `:443`、`:488` inline | 无 | 无 | 无 | 是 ×3 |
| `scrape/ProxyView.tsx` | 继承 | **无** | **无** | **无** | 1/6/0/0 | **裸 `Table`** `:302` | 无 |
| `SiteOperationsTab.tsx` | 是 `:183` 动态 | 无 | 无 | 无 | 无 | 无 | 是 `:273` |
| `DashboardTab.tsx` | 是 `:76` | 无 | 无 | 无 | 无 | 无 | 无 |

`data-*` 列格式为 `primary/label/actions/check` 计数。

由矩阵得出的三类主攻方向：

1. **缺面板契约**：`SettingsTab.tsx` 的 4 处表格与 `scrape/ProxyView.tsx` 的日志表已手写完整 `data-*` 语义，却没有 `AdminDataPanel` 包裹，因此 `--col-N-w` 变量无处注入、`table-layout: fixed` 不生效、`.admin-data-panel--grid` 的卡片化规则也不生效。这是列宽与移动端断层的直接原因。
2. **缺列定义与字段契约**：`ai/AiAuditPanel.tsx`、`ai/AiGenerationsPanel.tsx` 使用原生 `<table>`；`scrape/SourcesView.tsx`、`scrape/CenterView.tsx`、`JobsTab.tsx` 有面板而字段标签不完整。
3. **零共享组件**：`ContentPolicyTab.tsx`、`DashboardTab.tsx`、`ai/AiConfigPanel.tsx`、`ai/AiCoverPanel.tsx`、`ai/AiParamsPanel.tsx`、`ai/AiWritingPanel.tsx` 除 `AdminPage`（及个别指标条）外全自写。对这类页面，先判定其页面类型（配置/图表/工作流），再决定用哪套范本语言，不要一律套数据表。

### 3.4 标题一致性

父容器已建立按有效子页计算标题的元数据映射：`AiTab.tsx:30`（`AI_SUBTAB_META`）、`scrape/index.tsx:15`（`SCRAPE_VIEW_META`）、`SettingsTab.tsx:94`（`ACCOUNT_TAB_META`）、`SiteOperationsTab.tsx:20`（`OPERATION_TAB_META`）。深链、刷新、返回后标题与内容一致，这部分已完成，不要重做。

以下四处**内容区主标题与导航/页面名不一致**，P0 统一：

| 文件:行 | 当前标题 | 导航注册表（`admin-registry.ts`） | 建议对齐到 |
| --- | --- | --- | --- |
| `JobsTab.tsx:369` | 任务管理 | `:63` 任务队列 | 导航侧或页面侧二者取一，全站同字面 |
| `ContentPolicyTab.tsx:64` | 内容安全 | `:93` 安全策略 | 同上 |
| `DashboardTab.tsx:76` | 后台总览 | `:42` 总览 | 同上 |
| `AiTab.tsx:37` | AI 配置 | `:78` 配置 | 同上 |

另有 `SettingsTab.tsx` 的**页内重复标题**：页标题为动态子页名（`:436`），页内 `:630` 的 `<h2>登录审计</h2>` 在 `audit` 子页与页标题字面完全相同；`:713` 的「管理员操作审计」与页标题「操作审计」构成近似重复。按 §4.1 规则收敛为面板标题。

`scrape/index.tsx:44-45` 在 `sources` 视图主动把 `title`/`description` 置 `undefined`、由 `SourcesView` 自带页头——这是唯一已正确处理标题归属的案例，其他页面照此办理即可。

## 4. 统一视觉契约

### 4.1 页面骨架与标题

每个可导航子页只保留一个内容区主标题，由父容器的 `AdminPage` 负责。顶栏已有的导航上下文（`AdminShell.tsx:28` 的 `activeLabel`）不计为内容区标题。

- 小说范本适合「页头标题与计数 + 右侧搜索与主要操作 + 数据面板」。
- 章节范本适合「页头对象选择 + 工作对象上下文 + 目录或编辑面板」。
- 两页的工具栏位置与工作对象语义是差异点，其余同构，不要为了「完全一致」把章节的工作对象选择搬到面板内，或把小说的搜索搬到面板外。
- 多条件筛选类页面（审核、审计、代理日志）适合「页头 + 面板外筛选工具栏 + 数据面板」，工具栏位置参照审核队列页面已有的外置工具栏形态（`ModerationTab.tsx:584` 的 `moderation-toolbar` 在数据面板之外）。
- 不给每页机械添加概览卡、说明横幅、大图标或装饰数字。
- 列表数量使用标题旁的轻量 meta；只有真实独立指标才使用 `AdminMetricStrip`，它是唯一的「大数字」层级。
- 面板标题使用 `AdminPanelHeading` 或 `AdminPanel` 的标题槽位；**不重复当前页名制造第二个主标题**（面板标题写「作品目录」「章节目录」「审核列表」这类工作对象名）。
- 同一工作区域有一个视觉主要动作；多个相互独立的保存区可以各有保存按钮，不能为「一页一个按钮」破坏保存边界。

`AdminPage` 的标题自动向上取到 `AdminTabHeader`；`title` 传 `undefined` 时不渲染页头（`AdminPage.tsx:30`），用于子视图自带页头的场景。

### 4.2 表面、间距和主题

取值为编制基线的实测定义，执行时以计算样式复核：

| token | 值 | 定义行 | 用途 |
| --- | --- | --- | --- |
| `--admin-canvas` | `color-mix(in srgb, var(--bg-primary) 94%, #6b7280 6%)` | `admin-operations.css:9` | 后台画布底色 |
| `--admin-panel` | `var(--bg-card)` | `:10` | 面板/弹窗/侧栏表面 |
| `--admin-panel-muted` | `color-mix(in srgb, var(--bg-secondary) 78%, var(--accent-subtle))` | `:11` | 胶囊、页脚、次级表面 |
| `--admin-border` | `color-mix(in srgb, var(--border) 88%, var(--text-primary) 4%)` | `:13`（暗色覆写 `:1261`） | 通用描边 |
| `--admin-border-strong` | `color-mix(in srgb, var(--border) 62%, var(--text-primary) 15%)` | `:14` | 控件与弹窗描边 |
| `--admin-control-height` | `2.5rem` | `:15` | input/button/tabs-list 统一高度 |
| `--admin-input-radius` / `--admin-button-radius` | `12px` / `12px` | `:32` / `:33` | 控件圆角 |
| `--admin-radius` / `--admin-radius-sm` | `--radius-md`(10px) / `--radius-sm`(6px) | `:16` / `:17` | 中/小圆角 |
| `--admin-radius-dialog` | `--radius-xl`(16px) | `:22` | 弹窗外框 |
| `--admin-space-1..6` | `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 rem` | `:23-28` | 间距刻度 |
| `--admin-table-panel-radius` | `--radius-2xl`(20px) | `tokens.css:71` | 数据面板外圆角 |

- 使用 `--admin-canvas`、`--admin-panel`、`--admin-border`、`--admin-space-*`、现有语义颜色；不要在新页面另建固定奶油底色或硬编码品牌色。
- 数据面板是平面、清晰边框、统一圆角；不要增加更重阴影、渐变头图或浮起卡片。`Flat-By-Default` 规则适用于所有静止表面。
- 页面节奏由 `AdminPage` 的 `.admin-redesign-page` 管理（`:4956`/`:2065`，`display: grid; gap: 1rem`）；面板内部由统一 padding 管理。清理目标区域叠加的 `mb-*`、`space-y-*`、多层 `Card`，避免双倍间距。
- **`Card` 的 `gap-6` 必须与它的 `py-6` 一起归零。** `Card` 的类名是 `flex flex-col gap-6 rounded-xl border bg-card py-6 …`（`card.tsx:10`），`gap` 与 `padding` 是两个独立的间距来源。此前共享层只归零了 `padding` 而漏掉 `gap`，导致每一张「`Card` + 标题条」的卡片都在标题条与内容区之间多出 24px 死留白，表现为标题条下方一段无来由的空白。归零规则见 `admin-operations.css` 的 `.admin-redesign-page :is(.admin-panel-card, [data-slot='card']):has(> [data-slot='card-header'], > .admin-panel-heading)`，`padding` 与 `gap` 必须成对出现。注意 `CardContent` 等内部网格的 `gap`（`gap-4`/`gap-5`/`gap-8`）属于内容节奏，**不受影响也不得归零**。
- 新增任何「卡片 + 标题条」结构时，先确认该规则的选择器能命中（宿主元素须是 `Card` 或带 `admin-panel-card` 的元素，且标题条必须是其**直接子元素**）。
- 宽屏筛选保持单行，必要时按当前范本规则在窄屏分组换行。搜索框按用途设宽度（`.admin-search` 有 `max-width: 30rem`，`:6357`），窄屏允许铺满；长 URL、长提示词使用足够宽的输入区域。
- 输入框与按钮以范本**计算样式**为准；不要把 JSX 的 `size="sm"` 或文档数字直接当成最终高度。
- 保留亮色、暗色和现有强调色配置能力。`data-theme` 是当前暗色模式机制，不改成仅支持 `.dark`。

### 4.3 工具栏位置与条件状态

| 场景 | 推荐位置 | 必须保留 |
| --- | --- | --- |
| 单一搜索 + 新增 | 页头 actions，参考小说 | 搜索标签、原有防抖行为（小说 250ms） |
| 多维筛选、状态切换 | `AdminDataPanel` 外的 `AdminToolbar`，参考审核 | 筛选值、重置行为、分页回到原有起点的逻辑 |
| 当前目录内搜索和操作 | 面板内，参考章节 | 工作对象和选择上下文 |
| 已选项目批量操作 | 数据面板内、`AdminPanelHeading` 之下 | 已选数量、跨页选择既有语义、危险操作确认 |
| 表单的测试、保存 | 所属表单区域 | 各自 loading/disabled、保存反馈 |

`AdminToolbar` 的 `layout` 只有 `'inline'`（默认，搜索与筛选排一行）与 `'stacked'`（搜索在上、批量操作独立成第二行，分隔线区隔）两个取值（`AdminWorkspace.tsx:30`）。

条件控件切换时尽量保留槽位，参考审核「原因」字段的 placeholder 处理（`ModerationTab.tsx:605-622`：标签用 `--placeholder` 修饰符 + `aria-hidden`，控件位用 `aria-hidden="true"` 的空 span 占位）。不可用占位元素必须 `aria-hidden` 且不可聚焦；不要用透明的可点击控件占位。

### 4.4 数据面板：必须理解的实现限制

`AdminDataPanel` 在传入 `columns` 时只做两件事：注入 `--col-N-w` 变量、添加 `.admin-data-panel--grid`（`AdminWorkspace.tsx:174-184`）。`AdminColumn.label/primary/actions` **不会自动写入 TableCell，也不会自动渲染列**。调用方必须保持列定义顺序、表头、行单元格三者一致，并手动设置：

- 主字段：`data-primary=""`，保留可识别标题或对象名。
- 普通字段：`data-label="状态"` 等真实字段名。
- 操作列：`data-actions=""`，内部复用 `.admin-cell-actions`。
- 选择列：对照小说范本实际 checkbox 单元格（`data-check=""`）与现有 CSS，不创造未经支持的新属性。
- 空/错误/加载跨列行：正确 `colSpan`，避免被卡片规则拆成字段。

结构示意（不是可直接替换业务代码的完整组件）：

```tsx
const columns: readonly AdminColumn[] = [
  { key: 'name', label: '名称', width: '40%', primary: true },
  { key: 'status', label: '状态', width: '20%' },
  { key: 'actions', label: '操作', width: '20%', actions: true },
]

<AdminDataPanel columns={columns} ariaLabel="对象列表">
  <AdminPanelHeading title="对象目录" />
  <Table>
    {/* 保留既有 TableHeader、TableBody、TableRow 与 handler */}
    {/* name: <TableCell data-primary="" data-label="名称">…</TableCell> */}
    {/* status: <TableCell data-label="状态">…</TableCell> */}
    {/* actions: <TableCell data-actions=""><div className="admin-cell-actions">…</div></TableCell> */}
  </Table>
  {/* 保留分页组件以及原 page/offset 转换 */}
</AdminDataPanel>
```

列宽机制的实测边界：

- 固定列宽只在 `@media (min-width: 901px)` 生效：`.admin-data-panel--grid table { table-layout: fixed; width: 100% }`（`:6769-6773`），逐列规则覆盖第 1–12 列（`:6775-6822`）。**超过 12 列没有规则**，第 13 列起落到剩余宽度分配。新增列策略需单独审查，不宣称传入 `columns` 就已支持。
- 卡片化为 `@media (max-width: 900px)`（`:6935`）：thead 隐藏，`tr`/`td` 转 grid，`data-label` 变伪元素。**断点是 900px，不是 640px。**
- 范本统一使用**百分比**列宽（`NovelsTab.tsx:27-34` 的注释记录了原因：fixed 布局下百分比与 rem 混用时定长列会先吃掉宽度，900px 实测标题列只剩 40px）。合计 100%，任何宽度下等比缩放。
- `.admin-cell-tags` 在桌面只显示前 3 个标签加 `+N` 徽章，900px 以下恢复全部并隐藏 `+N`（`:6852`/`:6887`）；完整列表始终对读屏可见（`NovelsTab.tsx:568-583`）。这是刻意的视口相关截断，不是 bug。
- 列标签只是视觉伪元素，仍需真实 `table` 表头与可访问语义（`TableCaption`/`scope="col"`/`aria-sort`）。

普通对象表采用范本卡片化。审计展开详情、跨列日志和高密度比较表先检查 DOM；若不能安全卡片化，使用带边界的局部横向滚动，记录例外。不得直接把任意复杂表格包进 grid 面板导致详情行消失或字段错配。

长文本允许换行或摘要加详情入口；长 ID、URL、错误信息不能撑开整个页面（参考 `ProxyView.tsx:333` 的 `max-w-[360px] truncate` + `title`）。桌面和移动端都保留关键字段及操作，不能靠隐藏状态、时间或操作列达成「整齐」。

### 4.5 配置表单与工作流

- 表单使用 `AdminPanel` 或现有 Card 组合复用同一面板语言；不是要求所有 Card 都换成 `AdminDataPanel`。
- 同一功能域集中一组：标题、简短说明、字段、必要反馈、局部动作。
- 字段标签常驻，帮助文本保持次级，错误与字段对应；保留原值、限制范围、枚举和默认值。
- Input 的固定高度规则不能作用于 textarea。长提示词、章节正文、JSON 使用可伸缩的多行区域（`ChaptersTab.tsx:687-693` 的正文区与 `:885-895` 的手动标题区）。
- 配置草稿与当前生效值不能合并；例如代理仍需表达环境变量优先、管理端保存值及实际生效来源。
- 内容安全开关当前为即时请求保存（`ContentPolicyTab.tsx:89-94`）；不得擅自改为「编辑后点保存」。其他有保存按钮的表单也不得改为自动保存。
- 工作流保留原步骤顺序、输入状态、确认阶段和任务反馈。对已有紧凑成熟区域只调整共享外观，不为「统一」打散工作流。

### 4.6 弹窗、反馈与动效

- 普通后台弹窗复用 `.admin-dialog`（`:5754`），正文区域复用 `.admin-dialog__body`（`:2845`），按任务确定宽度，不把所有弹窗强制等宽。范本宽度：小说编辑 `sm:max-w-[540px]`、章节编辑 `620px`、章节融合 `760px`。
- Card / Dialog 组件用 `data-slot` 属性作为契约（`table.tsx` 用 `data-slot="table"` 等，`dialog.tsx` 用 `data-slot="dialog-*"`）。写 CSS 时优先匹配 `data-slot`，不要依赖 Tailwind 生成的类名。
- Radix Portal 位于 body 下，共享 token 必须可继承；不能只写 `.admin-layout .admin-dialog` 选择器。
- 检查弹窗焦点进入/返回、Escape、底部操作可达、窄屏最大高度及下拉不被裁剪。业务原有的保存中禁止关闭规则继续保留。
- 重用既有 loading/error/empty 组件和 `useToast`、`useConfirm`；新增页面内空状态可用 `AdminEmptyState`。不更换反馈库。
- 区分「尚未选择工作对象」「没有任何数据」「筛选无结果」「请求失败」四种状态，不可统一写「暂无数据」。章节范本 `:568-577` 与客户端监控 `:167-172` 是现成范例。
- 可复用范本轻量进入与颜色反馈；不添加动画依赖。轮询、翻页、输入时不重复整表入场；`prefers-reduced-motion: reduce` 下关闭非必要动画（现有 7 个 reduced-motion 块，见 `:217`、`:1242`、`:2281`、`:4947`、`:5168`、`:5472`、`:5720`）。

## 5. 共享层改动规则

优先复用当前组件；只有至少两个目标页面存在相同结构需求时，才增加轻量共享能力。

`AdminWorkspace.tsx` 现导出：`AdminToolbar`、`AdminSearch`、`AdminContextPanel`、`AdminMetricStrip`、`AdminQueueSummary`、`AdminDataPanel`、`AdminPanelHeading` 与 `AdminColumn` 接口。原独立文件 `components/admin/AdminPanel.tsx`（`Card` 的薄包装）**已删除**：PO18.tw 账号面板改造后它失去唯一消费者，成为零引用死代码。**不存在** `AdminPageHeading` 或 `AdminFormSection`——需要时按证据新增，不要引用不存在的 API。需要「卡片 + 标题条」时直接用 `Card` + `AdminPanelHeading`，二者组合会被共享层识别（见 §4.2 的归零规则）。

`AdminPanelHeading` 是最常用的面板标题（小说、章节、审核、任务、书源、抓取中心各步均在用）；`AdminContextPanel` 当前**零消费者**（`ChaptersTab.tsx:23` 的 import 是死 import，见 §6 P0）。

共享改动必须满足：

1. 旧 props 的默认渲染行为保持兼容；范本不能被迫跟着大改。
2. 通用规则写后台共享 class 或 token；单页问题写该页命名空间（`.account-*`、`.chapter-*`、`.source-*`、`.ai-*`、`.scrape-*`、`.site-operations*`）。
3. 修改前搜索全部调用者和同名 CSS。`admin-operations.css` 有 7535 行且存在大段后部覆盖（`:4088-4188` 与 `:5184-5256` 的控件段几乎完全重复、对话框层 `:2829/:4193/:5754` 三重定义）；**修正实际生效规则，不在末尾继续追加同名覆盖**。
4. 不用全局 `table`、`button`、`input` 选择器影响阅读页；不重新排序 `global.css` 的 imports 来解决局部问题。
5. 每次共享层改动，回归两个范本及一个本包目标页；对 portal 相关改动再检查一个真实打开的弹窗。
6. 不把纯视觉重构变成状态管理迁移、API 封装重写或整个大文件拆分工程。必要的展示子组件定义在模块顶层，避免 render 中定义导致重挂载。

## 6. 分阶段执行包

依赖顺序：**P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7**。每包内部按页面逐个迁移，一次最多处理 1–2 个页面；每个页面完成静态检查和关键行为核对后再进入下一个。以下分包不是要求创建独立代理或新任务。

### P0：基线、标题一致性与共享规则

允许文件：共享后台组件、`admin-operations.css`；四个父容器的标题元数据；`ChaptersTab.tsx` 的死 import 清理。

执行：

1. 保存 Git 基线与已有改动清单，运行一轮基线 `typecheck`、web tests、web build，记录既有失败。
2. 在可用的已登录本地后台截取两个范本：桌面、窄屏、暗色、一个弹窗；记录标题、控件、面板和行操作的实际计算样式。
3. 按 §3.4 统一四处标题不一致；把 `SettingsTab.tsx` 的页内重复标题降为面板标题。
4. 删除 `ChaptersTab.tsx:23`/`:25` 已确认无消费者的 `AdminContextPanel`、`AdminMetricStrip` import（实测全文件仅 import 处命中，属死 import）。
5. 明确数据表、表单、统计、流程四类布局；只抽出迁移试点已经需要的共享能力。
6. 用客户端监控或用户管理作为首个试点验证规则。P0/P1 可以连续完成，不需中途再次确认既定范本。

退出标准：没有新增重复主标题；两个范本外观保持；没有导航行为变化；后续包不需要各自重新发明页头和控件规格。

### P1：审核、安全策略与客户端监控（T01–T03）

主文件：`ModerationTab.tsx`、`ContentPolicyTab.tsx`、`MobileTelemetryTab.tsx`。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 内容审核 | 已具备 Toolbar/DataPanel/PanelHeading 与三模式列定义；本轮按双范本复核页头、工具栏与列表语言；三套 `MODERATION_COLUMNS` 的列数与 `thead` 顺序逐一比对 | 审核类型切换、状态与原因筛选、用户 ID 与搜索、分页、可见性动作与确认；举报模式的「原因」条件槽位必须手动切换验证；三种空状态与错误态 |
| 安全策略 | 当前仅 `AdminPage` + 单张 `Card`（`:68`），保持简洁单面板与合理最大宽度，对齐字段、开关、状态文字的控件规格 | 即时保存、`saving` 禁用、失败反馈；不添加与现状不符的保存按钮 |
| 客户端监控 | 已用 MetricStrip/Toolbar/DataPanel；补齐字段契约（当前 `data-actions` 为 0）、工具栏内裸 `<select>`（`:146`）与裸 `Input`（`:155`）的控件规格、高频事件区面板表面（`:192` 的裸 `div`） | 原状态筛选、搜索、刷新、状态更新 handler；近 30 天高频事件；长错误信息、空事件与失败态 |

退出标准：三页在移动端可用；条件切换与分页不丢失原语义；审核的原因槽位切换有证据。

### P2：账户四视图（T04–T07）

主文件：`SettingsTab.tsx`。**本包工作量最大**：该文件 881 行、4 处表格已手写完整 `data-*` 语义却未包 `AdminDataPanel`，且无 `AdminColumn` 常量。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 用户管理 | 把 `:503` 的 `admin-data-panel--grid` 手写 class 与 `:513` 的 `overflow-x-auto` 收敛为 `<AdminDataPanel columns={USER_COLUMNS}>`；现有指标条避免 Card 再包指标条 | 搜索、角色/状态筛选、分页和全部账号操作（重置密码、禁用、删除）；长用户名和邮箱不顶出操作 |
| 注册与邀请码 | 注册模式是配置面板，邀请码是数据面板；生成、复制、停用动作按作用对象归位；`:776` 的「邀请码」h2 降为面板标题 | 保存模式的原时机、邀请码用量/使用/停用状态；切换其他 settings view 不重置已有状态 |
| 登录审计 | `:639` 表格包进 `AdminDataPanel` 并补列定义；`:630` 的 h2 与页标题同字面，必须降为面板标题；筛选条已在面板外（`:598`） | 查询条件、结果状态、时间/IP 等既有字段和详情；不得为响应式直接删除审计信息 |
| 操作审计 | `:721` 表格同登录审计处理；`:713` 的 h2 改名以区分页标题 | 保留筛选值、分页、展开信息与事件含义，不改字段映射 |

退出标准：四种账户 view 均有移动端可用布局；条件切换与分页不丢失原语义；`SettingsTab.tsx` 内不再有裸 `Table`；页内无与页标题同字面的 h2。

### P3：队列、AI 任务与生成内容（T08–T11）

主文件：`JobsTab.tsx`、`ai/AiTasksPanel.tsx`、`ai/AiAuditPanel.tsx`、`ai/AiGenerationsPanel.tsx`。按需读取 `ai/shared.tsx`，不整体重写。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 任务队列 | 复用现有 `AdminQueueSummary`；统一任务列表、状态筛选、下载日志的标题与表面；页标题与导航字面统一（§3.4） | 轮询、取消/重试等现有动作、进度与日志展开；刷新不触发整页抖动 |
| AI 任务 | 任务工具栏外置（`:121`），任务主体和批次动作统一行密度 | 批次关系、状态、原分页、任务到产出跳转；进行中与失败可区分 |
| 调用审计 | `:123` 原生 `<table>` 与 `:121` 自写 `rounded-xl border` 容器收敛为 `AdminDataPanel`；去掉 Card 嵌套的多层外框；统一筛选、记录行和底部分页 | **该表含展开详情行，必须保留**；输入/输出 Token、图片张数、费用单位、模型和错误信息不混淆；不能为卡片化牺牲展开行 |
| 已生成内容 | `:352` 原生 `<table>` 同处理；参考审核统一筛选、状态和审阅操作；长文弹窗采用后台表面与焦点约定 | `scope`、`status`、`focusBatchId` props；批次展开、既有采纳/编辑/删除等动作、正文与候选标题 |

深链专项：从 AI 任务进入产出后，`/admin/ai?sub=content&batch=...` 的上下文必须保留；刷新、浏览器后退后内容与展开批次正确。`AiGenerationsPanel` 的 `title` 由 `AiTab.tsx:99` 提供，嵌入其他位置时不得因标题迁移多出全局页头。

退出标准：四页工具栏与行操作语言一致；展开行在窄屏没有消失；任务轮询和跨页跳转正常。

### P4：抓取三视图（T12–T14）

主文件：`scrape/CenterView.tsx`、`scrape/SourcesView.tsx`、`scrape/ProxyView.tsx`；`scrape/index.tsx` 的标题归属已正确，保持只读。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 抓取中心 | 已用 `AdminDataPanel`/`AdminPanelHeading`（`:593`/`:594`）；修正局部密度、表单与标题，桌面 main/aside 布局保留 | 链接/搜索/榜单入口、发现结果、作品确认、章节校验、抓取配置、开始任务、队列；保留旧 `view=discover` 到 center 的兼容（`index.tsx:27`） |
| 书源管理 | 页面只出现一个「书源管理」标题（已由 `index.tsx:44` 保证）；筛选与批量动作沿用已收口的 `.source-panel__bar`，补齐字段契约与 `AdminDataPanel` 列定义 | full/partial/unsupported/enabled 筛选语义、导入、连接检测、批量启停删、编辑与测试弹窗；`SourcesView.test.tsx` 已有断言不得删除 |
| 代理设置 | `:302` 裸 `Table` 包进 `AdminDataPanel` 并补列定义；配置字段、生效来源、测试区域、日志使用统一标题和面板；URL 字段留足空间 | 环境变量优先、保存草稿/有效值区别、连通测试与路由检查、日志刷新，各动作独立 loading；日志长 URL 与错误可读 |

退出标准：列表的普通/空/搜索无结果状态一致；导入和检测仍可操作；没有重复页头。

### P5：生成与配置（T15–T18）

主文件：`ai/AiWritingPanel.tsx`、`ai/AiCoverPanel.tsx`、`ai/AiConfigPanel.tsx`、`ai/AiParamsPanel.tsx`。这四个文件在编制基线下除 `AdminPage`（由 `AiTab` 提供）外零 workspace 组件采用，需先判定页面类型再套语言。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| AI 创作 | 参考章节管理的对象上下文；新写/续写选择、输入区、已有配置、结果与任务区形成清晰顺序 | 所有输入项与开关、前置校验、生成阶段、现有任务跳转；切模式不因 UI 组件重挂载丢失草稿 |
| 封面生成 | 小说选择和生成配置为操作区，当前封面和候选封面为图片工作区；统一按钮、面板和状态 | 图片比例、现有预览、候选选择/应用/弃用及生成反馈；不能把图片候选强制改成普通数据表 |
| AI 配置 | 文本供应商、图像供应商及其他现有功能按业务域分组，去除重复装饰头（`.ai-config-providers` 已有 1100px 双列规则，`:1809`） | 密钥遮罩、原供应商和模型字段、测试/保存行为；不把空密钥当作清空已有密钥 |
| 参数调优 | 各参数组复用面板和字段节奏，长提示词使用统一 textarea；保留局部说明 | 所有数值范围、默认值、枚举、开关、保存范围与 dirty 状态；不改提示词内容和生成策略 |

退出标准：四页字段、帮助文字和保存反馈一致；未发生接口 payload 变化；暗色弹层和长表单滚动可用。

### P6：统计与运营（T19–T23）

主文件：`DashboardTab.tsx`、`ai/AiUsagePanel.tsx`、`SiteOperationsTab.tsx`。

- 总览：保留真实指标、任务状态和快捷入口，只统一标题、指标条、面板与状态；不为了展示风格添加不存在的指标。页标题与导航字面统一（§3.4）。
- 用量统计：当前统计条已迁移到 `AdminMetricStrip`（`:84`）；保留 Recharts 与原趋势图交互；统一图表面板标题、筛选、空/失败状态。成本、Token 和调用次数的单位不改变。
- 运营概览：统一指标和运营功能面板，保留现有动作及数据说明。
- 流量分析：分类列表/图表保留原数据来源与统计口径，暗色图例、坐标文字、tooltip 可读。
- 内容分析：统一分类、连载/完结、最近更新等区域；保留列表详情弹窗和 CSV 导出。
- 三个运营 view 都应显示当前子页名（已由 `OPERATION_TAB_META` 保证）；指标数量随真实数据结构变化，不写死 4 格导致第 5 项挤出或末尾空格（`AdminMetricStrip` 与 `AdminQueueSummary` 已按项数注入列数变量，`AdminWorkspace.tsx:97`/`:126`）。
- 所有图表容器 `min-width: 0` 且有明确可渲染高度；缩放或切 tab 后不变成宽度 0，不让 tooltip 被新增 overflow 裁剪。

退出标准：五页在桌面和移动端均能读懂关键数据；没有「无数据=0」「错误=空结果」的新增混淆；单位、日期范围与导出契约保持。

### P7：总验收与文档收口

- 逐项核对 T01–T23 的状态，不把「已引用 AdminPage」当作完成。
- 对共享层变更执行一次全后台回归；检查两个范本未出现工具栏、标题、弹窗、表格卡片化回退。
- 只清理本轮已确认不再使用的 CSS/import。删选择器前用 `rg` 检查 TSX、动态 class 拼接与媒体查询，不整段删除旧后台样式文件。
- 完成第 8 节验收表，列出浏览器证据、命令结果、例外和遗留问题。
- 最终交付变更说明与验证记录，等待用户单独要求提交/推送。

## 7. 单页执行流程（每页照此重复）

1. **读行为**：列出当前页面的输入、查询条件、API 请求、操作、弹窗、状态和路由依赖。特别标记 loading/saving/disabled 和轮询 effect。
2. **选范本**：指定小说/章节中的主范本与必要例外；先写目标区域顺序，再改 JSX。
3. **小范围迁移**：保留 state、effect、handler 与 key，调整展示组件、class、槽位。拆展示组件时完整传回原 handler。
4. **检查功能差异**：比较 diff 中 handler、请求参数、条件渲染、分页转换、输入受控状态，避免样式修改夹带逻辑变化。
5. **运行必要检查**：格式、ESLint、typecheck；如涉及结构/状态关系，补最小有效的行为回归测试并运行相关测试。
6. **浏览器一轮集中检查**：桌面与移动一起检查，覆盖该页主状态和最高风险弹窗；集中修正发现的问题，再确认一次。仍有明确缺陷就记录并针对性修复，不无限做无目标的审美迭代。
7. **写进度**：记录文件、行为验证、截图、剩余阻碍，更新 T 编号状态；再进入下一页。

不要为纯 class 替换编写实现镜像测试。需要测试的是会丢草稿、改查询、破坏深链、错误移动端字段对应、改变确认行为等有实际回归价值的契约。

## 8. 验证要求

### 8.1 命令

以下命令均从仓库根目录执行，已核对当前 package scripts 存在。web workspace 没有 lint 或 format script，ESLint/Prettier 用根级配置直接调用。

```powershell
# P0 基线、每个执行包结束、P7 最终检查
npm run typecheck --workspace=@zhi-zhou/web
npm run test --workspace=@zhi-zhou/web
npm run build --workspace=@zhi-zhou/web
git diff --check

# 每页：替换成该页实际改动的文件；不要直接复制示例后漏掉其他文件
npx prettier --check web/src/pages/admin/MobileTelemetryTab.tsx
npx eslint web/src/pages/admin/MobileTelemetryTab.tsx

# 本地浏览器环境：按已有服务情况选择，避免启动第二份占用同端口
npm run dev:web
# 需要完整 API 且本地配置就绪时，使用已有根脚本 npm run dev
```

对 TSX/TS 文件执行 ESLint，对 CSS/Markdown 执行 Prettier；格式化仅限本次文件，不运行全仓库 `format:write`。包内没有行为改动且刚通过完整 web tests 时不逐个页面重复全套测试；类型检查失败先解决再进入下一页。基线失败与新增失败分开记录。

已有测试参考：`Admin.test.tsx`、`AdminShell.test.tsx`、`admin-registry.test.ts`、`ai/AiWritingPanel.test.tsx`、`scrape/SourcesView.test.tsx`。涉及共享页头、路由或抓取结构时检查其实际断言，不能随便删断言来「修绿」。

### 8.2 浏览器尺寸与主题

| 检查面 | 尺寸/条件 | 要确认的内容 |
| --- | --- | --- |
| 宽屏主要状态 | 1440×1000，侧边栏展开 | 标题、工具栏、密度、操作列；同类页面视觉一致 |
| 窄桌面 | 1024×900 | 侧栏占宽后的可用空间，不挤坏列与按钮 |
| 断点边界 | 901px 与 900px；工具栏相关再看 1241px/1240px | 表格到卡片切换、筛选组换行，无意外跳变 |
| 移动端 | 390×844，最低再检查 360px 宽 | 页面本身不横向溢出，局部滚动有边界，关键操作可达 |
| 主题 | 亮色和暗色；共享颜色改动时检查一个非默认强调色 | 文本、表面、Badge、表单、弹窗、图表 tooltip |
| 键盘/动态效果 | Tab、Shift+Tab、Enter、Escape，减少动态效果 | 焦点可见、顺序合理、弹窗焦点返回、无非必要动画 |

每页至少保存宽屏亮色、移动亮色、暗色主要状态证据。共享表格和工具栏断点集中验证一次；结构有特殊差异的页面追加专门验证。对比截图保持相同路由、数据、主题、侧栏状态和滚动位置，不以不同内容的截图证明样式等价。

### 8.3 状态和数据清单

每页检查适用项，标记「不适用」时写原因：初次加载、有数据、空列表、搜索无结果、请求失败、长文本、多状态、分页边界、已选批量项目、保存中、保存失败、禁用操作、弹窗打开与关闭。

表单页额外检查未保存值切换视图时保持现有行为；工作流页检查开始前/处理中/成功/失败；图表页检查有数据/空/错误。对敏感或有费用的真实操作，用可控本地测试数据、已有 mock 或专门测试实例验证，不为截屏启动真实 AI 生成或批量修改正式数据。

缺少登录时，可继续静态检查和受控组件验证，记录 `blocked-auth`；不能通过删除 `AdminGate`、改权限、伪造线上会话来获取截图。Mock 只能是开发/测试入口，不能改变生产运行路径。确需用户提供有效会话时说明具体待验页面，其余独立页面继续推进。

### 8.4 完成记录模板

执行者创建 `docs/admin-subtab-style-novels-chapters-validation-2026-09-16.md`。不要在未检查前填「通过」。

```markdown
## 执行环境
- 实际起始 SHA：
- 结束时工作区状态：
- 本地服务地址、是否使用 mock：
- 已有改动与保护方式：

## 页面清单
| ID | 页面 | 状态 | 变更文件 | 桌面/移动/暗色证据 | 行为验证 | 未验证项 |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | 内容审核 | pending | | | | |
（填写 T01–T23，不省略已复用组件的页面；另列 T24/T25 两范本回归）

状态可用：pending / in-progress / implemented / verified / blocked-auth / blocked-data。
implemented 仅表示代码完成；verified 需有适用行为和浏览器证据。

## 范本回归
- 小说管理：
- 章节管理：

## 命令结果
- 命令、通过/失败、关键输出、基线失败是否复现：

## 例外与遗留
- 页面、原因、影响、下一步：
```

截图可放项目忽略目录或本地 artifact 目录，验证记录写明可定位路径；避免把大量截图、测试账户数据或日志默认加入 Git。

## 9. 常见误实施与处理

| 误实施 | 正确处理 |
| --- | --- |
| 所有页面都套「统计卡 + 搜索 + 表格」 | 依据四类页面使用范本语言，保留流程与图表 |
| 把所有工具栏都搬到面板外 | 多条件筛选外置，目录内操作和批量操作保留上下文 |
| 只加 `columns` 就认为完成移动端 | 检查 `TableCell` 的 data 属性、`colSpan`、展开行与实际卡片渲染 |
| 以为 `AdminDataPanel` 会自动渲染列 | 只有 `--col-N-w` 注入与 `.admin-data-panel--grid`；表头与单元格全部手写 |
| 引用不存在的 `.admin-data-table` | 真实选择器是 `.admin-data-panel--grid table` |
| 按旧数字认为列宽只覆盖 8 列 | 实测覆盖第 1–12 列，第 13 列起无规则 |
| 从旧 DESIGN.md 复制高度和色板 | 核对当前范本计算样式，复用现有 token；kicker/hero 已退役 |
| 子面板再套一个 AdminPage | 父容器负责当前子页主标题，子面板负责业务区域 |
| 以为审核/安全策略仍是范本 | 本轮范本只有小说与章节，审核与安全策略是迁移目标 |
| 为统一 footer 改 offset 分页为 page API | 保留原 API，展示层只转换现有分页参数 |
| 把全部按钮都做成 primary | 按工作区域主次区分，危险动作保留原确认 |
| 全局表格规则解决一页错位 | 局部命名空间解决；真正通用再回归所有消费者 |
| 在页头搬按钮时搬走大段状态 | 使用局部操作栏；只有已有清晰 props 边界才上移 |
| 通过隐藏列、错误或帮助文字变简洁 | 保留任务必需信息，使用换行、详情或局部滚动 |
| 在 `admin-operations.css` 末尾继续追加同名覆盖 | 该文件已有大段重复段；修正实际生效的那处 |
| 自动修复所有 ESLint/格式问题 | 只处理本轮引入或本轮文件的必要问题，避免无关 diff |
| 缺少数据但写浏览器验收通过 | 区分实现完成、mock 验证、真实数据验证和待验收 |

## 10. 可直接交给 Luna MAX 的启动指令

把下面内容发给已经选择 Luna / MAX 的执行任务；无需让执行者再次设计方向。

```text
请在 E:\Developments\Projects\zhi-zhou 按以下手册实施后台子 tab 样式收口：
docs/admin-subtab-style-novels-chapters-manual-2026-09-16.md

视觉方向已确定：以小说管理（/admin/novels）、章节管理（/admin/chapters）为唯一固定范本，统一其余后台页面的视觉与组件语言。审核队列与安全策略本轮是迁移目标，不是范本。先读完整手册、工作区状态和当前提交，再按 P0→P7 连续执行，覆盖 T01–T23，并完成 T24/T25 两范本回归。

保留 API、权限、查询、分页、URL 深链、状态、轮询、表单值和确认流程。按页面类型适配，保留配置、图表、图片选择与抓取/生成流程。不要重新提视觉方案。一次迁移 1–2 个页面，完成必要检查再继续；不要只完成一个试点便停止。

本轮三个重点：SettingsTab.tsx 的 4 处裸 Table 要包进 AdminDataPanel 并补列定义；scrape/ProxyView.tsx 的日志表同样处理；ai/AiAuditPanel.tsx 与 ai/AiGenerationsPanel.tsx 的原生 table 收敛时不得牺牲展开详情行。P0 先统一四处页标题不一致并清理 ChaptersTab.tsx 的死 import。

不要调用子代理、创建新任务、提交、推送、部署或升级版本。保护已有未提交改动。涉及共享组件时回归两个范本；列宽 props 不会自动渲染移动字段，必须核对实际 DOM；写 CSS 优先匹配 data-slot 而不是 Tailwind 类名。

维护 docs/admin-subtab-style-novels-chapters-validation-2026-09-16.md，按 T01–T23 记录实施与验证进度；上下文恢复时从记录中未完成的下一项继续。缺少登录/数据时写清待验收范围并继续独立工作，不把构建成功当成视觉验收。

最终报告：覆盖了哪些页面，公共组件改变了什么，功能和视觉如何验证，两个范本有无回归，以及未验证项和明确遗留问题。完成全部已授权实施后再结束。
```
