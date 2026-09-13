# 后台子 tab 样式重构执行手册（Luna MAX）

日期：2026-09-13
仓库：`E:\Developments\Projects\zhi-zhou`
编制基线：`75e1d1b035b556409af54295cc49f4f68890dc92`
执行对象：Luna，MAX 推理强度。本文是实施任务书，不是已完成的改造记录。

## 1. 目标与授权边界

以当前 **小说管理、章节管理、审核队列** 为视觉范本，把其他后台子页面统一到同一套页面标题、间距、面板、工具栏、数据行、表单和弹窗语言。目标是进入不同子页面时保持一致的操作感，同时保留每个业务的工作流程。

本轮用户要求编制手册；实际前端改造在用户把本文交给执行任务后开始。编制时仅检查源代码、路由、组件和样式，没有打开已登录后台逐页进行视觉验收，也没有执行构建或运行时测试。下文“现状”指源码证据，“目标”与“验收”指后续执行要求。

执行时的范围：

- 修改 `web/src/pages/admin/` 中本文指定页面及它们实际使用的展示组件。
- 按需扩展 `web/src/components/admin/` 与后台作用域 CSS；保留 React、Radix/shadcn、现有图标、图表、反馈组件体系。
- 保留 API 调用、请求参数、状态含义、分页方式、筛选条件、权限判断、保存时机、轮询节奏、确认流程和深链。
- 三个范本作为固定对照；除修复必要的共享组件兼容问题外，不重新设计范本。
- 默认不改 API、数据库、提示词、模型参数值、依赖、版本、公共阅读页和全局导航结构。不顺手修与样式无关的业务问题。
- 默认不提交、不推送、不部署；不创建新任务、不调用其他代理。用户另行明确要求时再执行对应动作。

**完成定义：22 个目标页面都有实施记录和验收状态；共享组件变更未破坏三个范本；代码检查通过；实际浏览器可验证的状态有证据。缺少登录或测试数据时应列为待验收，不能把“编译成功”写成“全部完成”。**

## 2. 首次执行：先读什么

从项目根目录开始，先检查适用的 `AGENTS.md`、工作区状态和当前提交。本文中的行号会变化，定位优先用文件与符号。

```powershell
git status --short
git rev-parse HEAD
rg --files -g AGENTS.md
Get-Content web/src/pages/admin/admin-registry.ts
Get-Content web/src/components/admin/AdminPage.tsx
Get-Content web/src/components/admin/AdminTabHeader.tsx
Get-Content web/src/components/admin/AdminWorkspace.tsx
```

继续读这些文件，避免仅凭文件名猜实现：

| 顺序 | 文件 | 需要理解的内容 |
| --- | --- | --- |
| 1 | `web/src/pages/admin/NovelsTab.tsx` | 页头搜索、新增入口、`NOVEL_COLUMNS`、批量操作、表格与编辑弹窗 |
| 2 | `web/src/pages/admin/ChaptersTab.tsx` | 小说选择、目录上下文、`CHAPTER_COLUMNS`、编辑与融合标题弹窗 |
| 3 | `web/src/pages/admin/ModerationTab.tsx` | `MODERATION_COLUMNS`、审核类型切换、面板外工具栏、条件字段占位 |
| 4 | `web/src/styles/admin-operations.css` | `:root` 变量、后台页头、工具栏、弹窗、表格卡片化，以及文件后部覆盖规则 |
| 5 | `web/src/styles/global.css`、`tokens.css`、`shadcn.css`、`_admin.css`、`_admin-ui.css` | 样式导入顺序、主题桥接、旧样式来源 |
| 6 | `web/src/components/ui/table.tsx`、`dialog.tsx`、`button.tsx` | 自动包装层、`data-slot`、默认样式、Portal |
| 7 | `web/src/components/admin/AdminPanel.tsx`、`AdminEmptyState.tsx` | 表单面板与空状态的既有封装 |
| 8 | `web/src/pages/admin/AdminShell.tsx`、`Admin.tsx`、`admin-registry.ts` | 页面滚动所有权、路由与导航；正常情况下只读 |
| 9 | `PRODUCT.md`、`DESIGN.md` | 背景资料；与当前范本冲突时，按以下证据优先级处理 |

证据优先级：用户指定范本 → 当前范本实际 DOM 与计算样式 → 当前共享组件 → 设计文档 → 旧注释。不要根据旧文档重建一套外观。

### 2.1 已确认的文档与实现差异

- `PRODUCT.md` 仍描述“8 个后台管理 tab”，不适合用来确定本次范围。以下清单来自当前 `admin-registry.ts`。
- `DESIGN.md` 部分高度、圆角和暖色背景描述已落后于当前后台样式。当前 `--admin-control-height` 为 `2.5rem`，按钮和输入圆角变量为 `12px`，弹窗圆角引用 `--radius-xl`；最终效果仍应检查后部 CSS 与计算样式。
- `AdminWorkspace.tsx` 注释提及 `admin-workspace.css`，当前不存在该文件；表格相关实现位于 `admin-operations.css`。不要新建一个同名文件来“补齐”过时注释。
- `AdminTabHeader` 的 `kicker`、`variant` 仍可传入，但实现已忽略它们。不要用这两个参数恢复眉题或大幅放大的 Hero 页头。
- `.admin-redesign-page` 已由 `AdminPage` 自动附加，不需要子页面重复手写。

这些差异只用于避免误实施，不授权重写整个设计文档。

## 3. 页面范围：25 个可导航页面，3 个范本，22 个迁移目标

路由中的查询参数属于既有导航契约，不能改名。没有查询参数时，某些分组会恢复本地持久化的上次子页；验收具体页面时使用表中的完整 URL。

### 3.1 固定范本（回归检查，不列入迁移数量）

| 范本 | 路由 | 主文件 | 重点借鉴 |
| --- | --- | --- | --- |
| 小说管理 | `/admin/novels` | `NovelsTab.tsx` | 紧凑页头、搜索与新增、对象列表、排序、批量操作、行操作 |
| 章节管理 | `/admin/chapters` | `ChaptersTab.tsx` | 对象选择、目录上下文、工作区工具栏、长文本表单与弹窗 |
| 审核队列 | `/admin/moderation` | `ModerationTab.tsx` | 多条件筛选外置、模式切换稳定、内容摘录、语义状态 |

### 3.2 迁移清单

下表文件均相对 `web/src/pages/admin/`。页面内的编辑弹窗、展开详情、错误与空状态属于该页任务，不另计页数。

| ID | 页面 | 路由 | 主文件 | 类型 | 执行包 |
| --- | --- | --- | --- | --- | --- |
| T01 | 用户管理 | `/admin/settings?view=users` | `SettingsTab.tsx` | 对象列表 | P1 |
| T02 | 登录审计 | `/admin/settings?view=audit` | `SettingsTab.tsx` | 筛选列表 | P1 |
| T03 | 操作审计 | `/admin/settings?view=operation-audit` | `SettingsTab.tsx` | 筛选列表 | P1 |
| T04 | 客户端监控 | `/admin/mobile-telemetry` | `MobileTelemetryTab.tsx` | 指标与事件列表 | P1 |
| T05 | 任务队列 | `/admin/jobs` | `JobsTab.tsx` | 队列与日志 | P2 |
| T06 | AI 任务 | `/admin/ai?sub=tasks` | `ai/AiTasksPanel.tsx` | 队列列表 | P2 |
| T07 | 调用审计 | `/admin/ai?sub=audit` | `ai/AiAuditPanel.tsx` | 列表与展开详情 | P2 |
| T08 | 已生成内容 | `/admin/ai?sub=content` | `ai/AiGenerationsPanel.tsx` | 列表与审阅弹窗 | P2 |
| T09 | 书源管理 | `/admin/scrape?view=sources` | `scrape/SourcesView.tsx` | 筛选列表与导入 | P3 |
| T10 | 注册与邀请码 | `/admin/settings?view=registration` | `SettingsTab.tsx` | 配置与列表 | P4 |
| T11 | 代理设置 | `/admin/scrape?view=proxy` | `scrape/ProxyView.tsx` | 配置、检测与日志 | P4 |
| T12 | 安全策略 | `/admin/content-policy` | `ContentPolicyTab.tsx` | 即时保存配置 | P4 |
| T13 | AI 配置 | `/admin/ai?sub=config` | `ai/AiConfigPanel.tsx` | 分组配置 | P4 |
| T14 | 参数调优 | `/admin/ai?sub=params` | `ai/AiParamsPanel.tsx` | 长表单配置 | P4 |
| T15 | AI 创作 | `/admin/ai?sub=writing` | `ai/AiWritingPanel.tsx` | 生成工作流 | P5 |
| T16 | 封面生成 | `/admin/ai?sub=cover` | `ai/AiCoverPanel.tsx` | 生成与图片选择 | P5 |
| T17 | 抓取中心 | `/admin/scrape?view=center` | `scrape/CenterView.tsx`、`scrape/center/*` 中实际使用组件 | 多步骤工作流 | P5 |
| T18 | 总览 | `/admin/dashboard` | `DashboardTab.tsx` | 指标与快捷入口 | P6 |
| T19 | 用量统计 | `/admin/ai?sub=usage` | `ai/AiUsagePanel.tsx` | 指标与趋势图 | P6 |
| T20 | 运营概览 | `/admin/site-operations?view=overview` | `SiteOperationsTab.tsx` | 指标与运营面板 | P6 |
| T21 | 流量分析 | `/admin/site-operations?view=traffic` | `SiteOperationsTab.tsx` | 指标与分类分析 | P6 |
| T22 | 内容分析 | `/admin/site-operations?view=content` | `SiteOperationsTab.tsx` | 指标、分布与详情 | P6 |

总览和客户端监控虽然是一级入口，本手册将它们纳入“其他后台页面”以完成一致性收口。旧文档提到的独立“解析规则”不是当前注册表中的单独入口，不凭旧文档新建页面。

## 4. 统一视觉契约

### 4.1 页面骨架与标题

每个可导航子页只保留一个内容区主标题，由父容器的 `AdminPage` 负责。顶栏已有的导航上下文不计为内容区标题。

- 小说范本适合“页头标题与计数 + 右侧搜索与主要操作 + 数据面板”。
- 审核范本适合“页头 + 独立筛选工具栏 + 数据面板”。
- 章节范本适合“页头对象选择 + 工作对象上下文 + 目录或编辑面板”。
- 不给每页机械添加概览卡、说明横幅、大图标或装饰数字。
- 列表数量使用标题旁的轻量 meta；只有真实独立指标才使用 `AdminMetricStrip`。
- 内容区主标题显示当前子页名。AI、抓取、账户、运营分组的父级身份由导航保留。
- 面板标题使用 `AdminPanelHeading` 或 `AdminPanel` 的标题槽位；不重复当前页名制造第二个主标题。
- 同一工作区域有一个视觉主要动作；多个相互独立的保存区可以各有保存按钮，不能为“一页一个按钮”破坏保存边界。

已发现的标题问题：`scrape/index.tsx` 对所有视图固定显示“抓取中心”，而 `SourcesView.tsx` 另有 `AdminTabHeader`；`AiTab.tsx`、`SettingsTab.tsx`、`SiteOperationsTab.tsx` 仍显示父分组标题。执行 P0 时统一由父容器依据**已经解析出的有效子页状态**选择标题和说明，不另写第二套 URL 解析状态。

推荐以本地静态映射表解决标题元数据；普通页面动作仍交给拥有状态和 handler 的子面板。不要为了把所有按钮塞到页头而搬运整个业务状态。书源自己的重复页头可以降为工具栏/面板操作，保留导入、刷新等现有入口。

### 4.2 表面、间距和主题

- 使用 `--admin-canvas`、`--admin-panel`、`--admin-border`、`--admin-space-*`、现有语义颜色；不要在新页面另建固定奶油底色或硬编码品牌色。
- 当前三个范本数据面板是平面、清晰边框和统一圆角；不要给其他页面增加更重阴影、渐变头图或浮起卡片。
- 页面节奏由 `AdminPage` 管理；面板内部由统一 padding 管理。清理目标区域叠加的 `mb-*`、`space-y-*`、多层 `Card`，避免双倍间距。
- 宽屏筛选保持单行，必要时按当前范本规则在窄屏分组换行。搜索框按用途设宽度，窄屏允许铺满；长 URL、长提示词使用足够宽的输入区域。
- 输入框与按钮以范本**计算样式**为准；不要把 JSX 的 `size="sm"` 或文档数字直接当成最终高度。
- 保留亮色、暗色和现有强调色配置能力。`data-theme` 是当前暗色模式机制，不改成仅支持 `.dark`。

### 4.3 工具栏位置与条件状态

| 场景 | 推荐位置 | 必须保留 |
| --- | --- | --- |
| 单一搜索 + 新增 | 页头 actions，参考小说 | 搜索标签、原有触发/防抖行为 |
| 多维筛选、状态切换 | `AdminDataPanel` 外的 `AdminToolbar`，参考审核 | 筛选值、重置行为、分页回到原有起点的逻辑 |
| 当前目录内搜索和操作 | 面板内，参考章节 | 工作对象和选择上下文 |
| 已选项目批量操作 | 数据面板内 | 已选数量、跨页选择既有语义、危险操作确认 |
| 表单的测试、保存 | 所属表单区域 | 各自 loading/disabled、保存反馈 |

条件控件切换时尽量保留槽位，如审核“原因”。不可用占位元素应 `aria-hidden` 且不可聚焦；不要用透明的可点击控件占位。桌面可预留宽度，移动端应合理释放空白。

### 4.4 数据面板：必须理解的实现限制

`AdminDataPanel columns={...}` 目前只注入列宽变量并添加 `.admin-data-panel--grid`。`AdminColumn.label/primary/actions` **不会自动写入 TableCell，也不会自动渲染列**。调用方必须保持列定义顺序、表头、行单元格三者一致，并手动设置：

- 主字段：`data-primary=""`，保留可识别标题或对象名。
- 普通字段：`data-label="状态"` 等真实字段名。
- 操作列：`data-actions=""`，内部复用 `.admin-cell-actions`。
- 选择列：对照小说范本实际 checkbox 单元格与现有 CSS，不创造未经支持的新属性。
- 空/错误/加载跨列行：正确 `colSpan`，避免被卡片规则拆成字段。

结构示意（不是可直接替换业务代码的完整组件）：

```tsx
const columns: readonly AdminColumn[] = [
  { key: 'name', label: '名称', primary: true },
  { key: 'status', label: '状态', width: '8rem' },
  { key: 'actions', label: '操作', actions: true, width: '8rem' },
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

当前桌面固定列宽规则显式覆盖第 1–8 列；超过 8 列要审查新增列策略，不宣称传入 columns 就已支持。当前通用卡片断点为 `900px`，不是 `640px`。列标签只是视觉伪元素，仍需真实 table 表头与可访问语义。

普通对象表采用范本卡片化。审计展开详情、跨列日志和高密度比较表先检查 DOM；若不能安全卡片化，使用带边界的局部横向滚动，记录例外。不得直接把任意复杂表格包进 grid 面板导致详情行消失或字段错配。

长文本允许换行或摘要加详情入口；长 ID、URL、错误信息不能撑开整个页面。桌面和移动端都保留关键字段及操作，不能靠隐藏状态、时间或操作列达成“整齐”。

### 4.5 配置表单与工作流

- 表单使用 `AdminPanel` 或现有 Card 组合复用同一面板语言；不是要求所有 Card 都换成 `AdminDataPanel`。
- 同一功能域集中一组：标题、简短说明、字段、必要反馈、局部动作。
- 字段标签常驻，帮助文本保持次级，错误与字段对应；保留原值、限制范围、枚举和默认值。
- Input 的固定高度规则不能作用于 textarea。长提示词、章节正文、JSON 使用可伸缩的多行区域。
- 配置草稿与当前生效值不能合并；例如代理仍需表达环境变量优先、管理端保存值及实际生效来源。
- 内容安全开关当前为即时请求保存；不得擅自改为“编辑后点保存”。其他有保存按钮的表单也不得改为自动保存。
- 工作流保留原步骤顺序、输入状态、确认阶段和任务反馈。对已有紧凑成熟区域只调整共享外观，不为“统一”打散工作流。

### 4.6 弹窗、反馈与动效

- 普通后台弹窗复用 `.admin-dialog`，正文区域复用 `.admin-dialog__body`，按任务确定宽度，不把所有弹窗强制等宽。
- AI 生成内容弹窗当前有专用 `ai-generation-dialog` 和高度约束；迁移时保留长文阅读、编辑、候选标题和滚动能力，先检查叠加 `.admin-dialog` 是否冲突。
- Radix Portal 位于 body 下，共享 token 必须可继承；不能只写 `.admin-layout .admin-dialog` 选择器。
- 检查弹窗焦点进入/返回、Escape、底部操作可达、窄屏最大高度及下拉不被裁剪。业务原有的保存中禁止关闭规则继续保留。
- 重用既有 loading/error/empty 组件和 `useToast`、`useConfirm`；新增页面内空状态可用 `AdminEmptyState`。不更换反馈库。
- 区分“尚未选择工作对象”“没有任何数据”“筛选无结果”“请求失败”，不可统一写“暂无数据”。
- 可复用范本轻量进入与颜色反馈；不添加动画依赖。轮询、翻页、输入时不重复整表入场，减少动态效果设置下关闭非必要动画。

## 5. 共享层改动规则

优先复用当前组件；只有至少两个目标页面存在相同结构需求时，才增加轻量共享能力。

允许按证据增加 `AdminToolbar` 的布局变体、独立 `AdminFormSection` 或表格底部分页区域封装，但这些名称均为**候选新增能力**，不是现有 API。不要先建一个拥有几十个参数的万能页面组件。

共享改动必须满足：

1. 旧 props 的默认渲染行为保持兼容；范本不能被迫跟着大改。
2. 通用规则写后台共享 class 或 token；单页问题写该页命名空间。
3. 修改前搜索全部调用者和同名 CSS。`admin-operations.css` 很长且存在后部覆盖；应修正实际生效规则，不在末尾无限追加同名覆盖。
4. 不用全局 `table`、`button`、`input` 选择器影响阅读页；不重新排序 `global.css` 的 imports 来解决局部问题。
5. 每次共享层改动，回归三个范本及一个本包目标页；对 portal 相关改动再检查一个真实打开的弹窗。
6. 不把纯视觉重构变成状态管理迁移、API 封装重写或整个大文件拆分工程。必要的展示子组件定义在模块顶层，避免 render 中定义导致重挂载。

## 6. 分阶段执行包

依赖顺序：**P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7**。每包内部按页面逐个迁移，一次最多处理 1–2 个页面；每个页面完成编译检查和关键行为核对后再进入下一个。以下分包不是要求创建独立代理或新任务。

### P0：基线、页头归属与共享规则

允许文件：共享后台组件、`admin-operations.css`；`AiTab.tsx`、`scrape/index.tsx`、`SettingsTab.tsx`、`SiteOperationsTab.tsx` 的页头元数据；书源页重复页头的最小调整。

执行：

1. 保存 Git 基线与已有改动清单，运行一轮基线 typecheck、web tests、web build，记录既有失败。
2. 在可用的已登录本地后台截取三个范本：桌面、窄屏、暗色、一个弹窗；记录标题、控件、面板和行操作的实际计算样式。
3. 建立当前子页标题映射，复用父容器既有有效状态；刷新、后退和持久化恢复后标题必须与内容一致。
4. 明确数据表、表单、统计、流程四类布局；只抽出迁移试点已经需要的共享能力。
5. 用用户管理作为首个试点验证规则。P0/P1 可以连续完成，不需中途再次确认既定范本。

退出标准：没有新增重复主标题；三个范本外观保持；没有导航行为变化；后续包不需要各自重新发明页头和控件规格。

### P1：账户列表与客户端监控（T01–T04）

主文件：`SettingsTab.tsx`、`MobileTelemetryTab.tsx`；如有必要使用薄的展示子组件，但业务状态仍留原处。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 用户管理 | 参考小说目录统一用户行、状态、操作；现有概览指标避免 Card 再包指标条；多条件筛选按审核外置 | 搜索、角色/状态等当前筛选、分页和全部现有账号操作；长用户名和邮箱不顶出操作 |
| 登录审计 | 标准页头、独立筛选条、事件列表和分页；结果颜色使用语义 token | 查询条件、结果状态、时间/IP 等既有字段和详情；不得为响应式直接删除审计信息 |
| 操作审计 | 与登录审计共用展示结构；长对象/动作/结果摘要有稳定宽度 | 保留筛选值、分页、展开信息与事件含义，不改字段映射 |
| 客户端监控 | 已使用 MetricStrip/Toolbar/DataPanel，重点补齐一致列布局、字段标签、高频事件区面板 | 原事件筛选、刷新、近 30 天高频事件；长错误信息、空事件和加载失败 |

退出标准：三种账户 view 与监控页均有移动端可用布局；条件切换与分页不丢失原语义；注册 view 尚未迁移也不受影响。

### P2：队列、调用审计与生成内容（T05–T08）

主文件：`JobsTab.tsx`、`ai/AiTasksPanel.tsx`、`ai/AiAuditPanel.tsx`、`ai/AiGenerationsPanel.tsx`。按需读取 `ai/shared.tsx`，不整体重写。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 任务队列 | 复用现有 QueueSummary；统一任务列表、状态筛选、下载日志的标题与表面 | 轮询、取消/重试等现有动作、进度与日志展开；刷新不触发整页抖动 |
| AI 任务 | 任务工具栏外置，任务主体和批次动作统一行密度 | 批次关系、状态、原分页、任务到产出跳转；进行中与失败可区分 |
| 调用审计 | 去掉 Card 嵌套的多层外框；统一筛选、记录行和底部分页 | 当前原生 table 中存在展开详情行，必须保留；输入/输出 Token、图片张数、费用单位、模型和错误信息不混淆 |
| 已生成内容 | 参考审核统一筛选、状态和审阅操作；长文弹窗采用后台表面与焦点约定 | `scope`、`status`、`focusBatchId` props；批次展开、既有采纳/编辑/删除等动作、正文与候选标题 |

深链专项：从 AI 任务进入产出后，`/admin/ai?sub=content&batch=...` 的上下文必须保留；刷新、浏览器后退后内容与展开批次正确。其他地方嵌入的 `AiGenerationsPanel` 不得因标题迁移多出全局页头。

退出标准：四页工具栏与行操作语言一致；展开行在窄屏没有消失；任务轮询和跨页跳转正常。

### P3：书源管理（T09）

主文件：`scrape/SourcesView.tsx`；必要时联动 `scrape/index.tsx`。先保留当前导入区与书源操作结构，再归一化外观。

- 页面只出现一个“书源管理”内容标题。
- 搜索、兼容性/启用状态筛选与动作整理到可换行的外置工具栏，参考审核；保留 full/partial/unsupported/enabled 的现有筛选语义。
- 书源记录、批量操作和统计说明复用列表语言；导入区保持独立功能面板。
- 连通性测试与编辑弹窗采用相同标题、正文、footer、状态反馈规格，保留专用宽度。
- 验证导入、搜索、筛选、选择、启停、连通性测试及当前页面提供的其他动作；测试结果中 URL 和错误信息可读。
- 不删除看似“旧”的解析规则或未读组件；先从真实 import 链确认是否被使用。

退出标准：列表的普通/空/搜索无结果状态一致；导入和检测仍可操作；没有重复页头。

### P4：配置类页面（T10–T14）

主文件：`SettingsTab.tsx`、`scrape/ProxyView.tsx`、`ContentPolicyTab.tsx`、`ai/AiConfigPanel.tsx`、`ai/AiParamsPanel.tsx`。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| 注册与邀请码 | 注册模式是一个配置面板，邀请码是一个数据面板；生成、复制、停用动作按作用对象归位 | 保存模式的原时机、邀请码用量/使用/停用状态；切换其他 settings view 不重置已有状态 |
| 代理设置 | 配置字段、生效来源、测试区域、日志使用统一标题和面板；URL 字段留足空间 | 环境变量优先、保存草稿/有效值区别、连通测试与路由检查、日志刷新，各动作独立 loading |
| 安全策略 | 保留简洁单面板和合理最大宽度；对齐字段、开关、状态文字 | 即时保存、saving 禁用、失败反馈；不添加与现状不符的保存按钮 |
| AI 配置 | 文本供应商、图像供应商及其他现有功能按业务域分组，去除重复装饰头 | 密钥遮罩、原供应商和模型字段、测试/保存行为；不把空密钥当作清空已有密钥 |
| 参数调优 | 各参数组复用面板和字段节奏，长提示词使用统一 textarea；保留局部说明 | 所有数值范围、默认值、枚举、开关、保存范围与 dirty 状态；不改提示词内容和生成策略 |

`scrape/Po18AccountPanel.tsx` 若在实际流程中使用，跟随所属抓取页面检查外观；不因为有“Account”名称把它搬到账户注册区。

退出标准：五页字段、帮助文字和保存反馈一致；未发生接口 payload 变化；暗色弹层和长表单滚动可用。

### P5：生成与抓取工作流（T15–T17）

主文件：`ai/AiWritingPanel.tsx`、`ai/AiCoverPanel.tsx`、`scrape/CenterView.tsx` 及实际 import 的 `scrape/center/*`。

| 页面 | 具体改造 | 保留与专项验收 |
| --- | --- | --- |
| AI 创作 | 参考章节管理的对象上下文；新写/续写选择、输入区、已有配置、结果与任务区形成清晰顺序 | 所有输入项与开关、前置校验、生成阶段、现有任务跳转；切模式不因 UI 组件重挂载丢失草稿 |
| 封面生成 | 小说选择和生成配置为操作区，当前封面和候选封面为图片工作区；统一按钮、面板和状态 | 图片比例、现有预览、候选选择/应用/弃用及生成反馈；不能把图片候选强制改成普通数据表 |
| 抓取中心 | 已使用 AdminDataPanel/PanelHeading 的入口、发现、配置、队列保留结构；修正局部密度、表单与标题 | 链接/搜索/榜单入口、发现结果、作品确认、章节校验、抓取配置、开始任务、队列、配置迁移；保留旧 `view=discover` 到 center 的兼容 |

抓取中心有成熟的 main/aside 布局，不为“套模板”推翻。桌面让队列与工作区关系清楚，窄屏按用户任务顺序堆叠。旧 `StepAnalyze/StepConfig/StepConfirm` 是否在当前路径使用，应先查 import，不对整个目录做盲目全替换。

退出标准：三个流程可从入口走到结果/任务反馈；无输入丢失、重复请求或主动作失联；失败状态可继续原有恢复操作。

### P6：统计与运营（T18–T22）

主文件：`DashboardTab.tsx`、`ai/AiUsagePanel.tsx`、`SiteOperationsTab.tsx`。

- 总览：保留真实指标、任务状态和快捷入口，只统一标题、指标条、面板与状态；不为了展示风格添加不存在的指标。
- 用量统计：当前自定义四格统计条优先复用 `AdminMetricStrip`，保留 Recharts 与原趋势图交互；统一图表面板标题、筛选、空/失败状态。成本、Token 和调用次数的单位不改变。
- 运营概览：统一指标和运营功能面板，保留现有动作及数据说明。
- 流量分析：分类列表/图表保留原数据来源与统计口径，暗色图例、坐标文字、tooltip 可读。
- 内容分析：统一分类、连载/完结、最近更新等区域；保留列表详情弹窗和 CSV 导出。
- 三个运营 view 都应显示当前子页名；指标数量随真实数据结构变化，不写死 4 格导致第 5 项挤出或末尾空格。
- 所有图表容器 `min-width: 0` 且有明确可渲染高度；缩放或切 tab 后不变成宽度 0，不让 tooltip 被新增 overflow 裁剪。

退出标准：五页在桌面和移动端均能读懂关键数据；没有“无数据=0”“错误=空结果”的新增混淆；单位、日期范围与导出契约保持。

### P7：总验收与文档收口

- 逐项核对 T01–T22 的状态，不把“已引用 AdminPage”当作完成。
- 对共享层变更执行一次全后台回归；检查三个范本未出现工具栏、标题、弹窗、表格卡片化回退。
- 只清理本轮已确认不再使用的 CSS/import。删选择器前用 `rg` 检查 TSX、动态 class 拼接与媒体查询，不整段删除旧后台样式文件。
- 完成第 8 节验收表，列出浏览器证据、命令结果、例外和遗留问题。
- 最终交付变更说明与验证记录，等待用户单独要求提交/推送。

## 7. 单页执行流程（每页照此重复）

1. **读行为**：列出当前页面的输入、查询条件、API 请求、操作、弹窗、状态和路由依赖。特别标记 loading/saving/disabled 和轮询 effect。
2. **选范本**：指定小说/章节/审核中的主范本与必要例外；先写目标区域顺序，再改 JSX。
3. **小范围迁移**：保留 state、effect、handler 与 key，调整展示组件、class、槽位。拆展示组件时完整传回原 handler。
4. **检查功能差异**：比较 diff 中 handler、请求参数、条件渲染、分页转换、输入受控状态，避免样式修改夹带逻辑变化。
5. **运行必要检查**：格式、ESLint、typecheck；如涉及结构/状态关系，补最小有效的行为回归测试并运行相关测试。
6. **浏览器一轮集中检查**：桌面与移动一起检查，覆盖该页主状态和最高风险弹窗；集中修正发现的问题，再确认一次。仍有明确缺陷就记录并针对性修复，不无限做无目标的审美迭代。
7. **写进度**：记录文件、行为验证、截图、剩余阻碍，更新 T 编号状态；再进入下一页。

不要为纯 class 替换编写实现镜像测试。需要测试的是会丢草稿、改查询、破坏深链、错误移动端字段对应、改变确认行为等有实际回归价值的契约。

## 8. 验证要求

### 8.1 命令

以下命令均从仓库根目录执行，已核对当前 package scripts 存在。不要假设 web workspace 有 lint 或 format script。

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

对 TSX/TS 文件执行 ESLint，对 CSS/Markdown 执行 Prettier；格式化仅限本次文件，不运行全仓库 `format:write`。包内没有行为改动且刚通过完整 web tests 时不逐个页面重复全套测试；类型检查失败先解决再进入下一页。基线失败与新增失败分开记录，旧记录里的 warning 不代表现在仍存在。

已有测试参考：`Admin.test.tsx`、`AdminShell.test.tsx`、`admin-registry.test.ts`、`ai/AiWritingPanel.test.tsx`。涉及共享页头、路由或 AI 创作结构时检查其实际断言，不能随便删断言来“修绿”。

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

每页检查适用项，标记“不适用”时写原因：初次加载、有数据、空列表、搜索无结果、请求失败、长文本、多状态、分页边界、已选批量项目、保存中、保存失败、禁用操作、弹窗打开与关闭。

表单页额外检查未保存值切换视图时保持现有行为；工作流页检查开始前/处理中/成功/失败；图表页检查有数据/空/错误。对敏感或有费用的真实操作，用可控本地测试数据、已有 mock 或专门测试实例验证，不为截屏启动真实 AI 生成或批量修改正式数据。

缺少登录时，可继续编译检查和受控组件验证，记录 `blocked-auth`；不能通过删除 AdminGate、改权限、伪造线上会话来获取截图。Mock 只能是开发/测试入口，不能改变生产运行路径。确需用户提供有效会话时说明具体待验页面，其余独立页面继续推进。

### 8.4 完成记录模板

执行者创建 `docs/admin-subtab-style-luna-max-validation-2026-09-13.md`。不要在未检查前填“通过”。

```markdown
## 执行环境
- 实际起始 SHA：
- 结束时工作区状态：
- 本地服务地址、是否使用 mock：
- 已有改动与保护方式：

## 页面清单
| ID | 页面 | 状态 | 变更文件 | 桌面/移动/暗色证据 | 行为验证 | 未验证项 |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | 用户管理 | pending | | | | |
（填写 T01–T22，不省略已复用组件的页面）

状态可用：pending / in-progress / implemented / verified / blocked-auth / blocked-data。
implemented 仅表示代码完成；verified 需有适用行为和浏览器证据。

## 范本回归
- 小说：
- 章节：
- 审核（含原因控件切换）：

## 命令结果
- 命令、通过/失败、关键输出、基线失败是否复现：

## 例外与遗留
- 页面、原因、影响、下一步：
```

截图可放项目忽略目录或本地 artifact 目录，验证记录写明可定位路径；避免把大量截图、测试账户数据或日志默认加入 Git。

## 9. 常见误实施与处理

| 误实施 | 正确处理 |
| --- | --- |
| 所有页面都套“统计卡 + 搜索 + 表格” | 依据四类页面使用范本语言，保留流程与图表 |
| 把所有工具栏都搬到面板外 | 多条件筛选外置，目录内操作和批量操作保留上下文 |
| 只加 `columns` 就认为完成移动端 | 检查 TableCell 的 data 属性、colSpan、展开行与实际卡片渲染 |
| 从旧 DESIGN.md 复制高度和色板 | 核对当前范本计算样式，复用现有 token |
| 子面板再套一个 AdminPage | 父容器负责当前子页主标题，子面板负责业务区域 |
| 为统一 footer 改 offset 分页为 page API | 保留原 API，展示层只转换现有分页参数 |
| 把全部按钮都做成 primary | 按工作区域主次区分，危险动作保留原确认 |
| 全局表格规则解决一页错位 | 局部命名空间解决；真正通用再回归所有消费者 |
| 在页头搬按钮时搬走大段状态 | 使用局部操作栏；只有已有清晰 props 边界才上移 |
| 通过隐藏列、错误或帮助文字变简洁 | 保留任务必需信息，使用换行、详情或局部滚动 |
| 自动修复所有 ESLint/格式问题 | 只处理本轮引入或本轮文件的必要问题，避免无关 diff |
| 缺少数据但写浏览器验收通过 | 区分实现完成、mock 验证、真实数据验证和待验收 |

## 10. 可直接交给 Luna MAX 的启动指令

把下面内容发给已经选择 Luna / MAX 的执行任务；无需让执行者再次设计方向。

```text
请在 E:\Developments\Projects\zhi-zhou 按以下手册实施后台子 tab 样式重构：
docs/admin-subtab-style-luna-max-execution-manual-2026-09-13.md

视觉方向已确定：以当前小说管理、章节管理、审核队列为固定范本，统一其他后台页面的视觉与组件语言。先读完整手册、适用 AGENTS.md 和工作区状态，再按 P0→P7 连续执行，覆盖 T01–T22。

保留 API、权限、查询、分页、URL 深链、状态、轮询、表单值和确认流程。按页面类型适配，保留配置、图表、图片选择与抓取/生成流程。不要重新提视觉方案。一次迁移 1–2 个页面，完成必要检查再继续；不要只完成一个试点便停止。

不要调用子代理、创建新任务、提交、推送、部署或升级版本。保护已有未提交改动。涉及共享组件时回归三个范本；列宽 props 不会自动渲染移动字段，必须核对实际 DOM。

维护 docs/admin-subtab-style-luna-max-validation-2026-09-13.md，按 T01–T22 记录实施与验证进度；上下文恢复时从记录中未完成的下一项继续。缺少登录/数据时写清待验收范围并继续独立工作，不把构建成功当成视觉验收。

最终报告：覆盖了哪些页面，公共组件改变了什么，功能和视觉如何验证，三个范本有无回归，以及未验证项和明确遗留问题。完成全部已授权实施后再结束。
```
