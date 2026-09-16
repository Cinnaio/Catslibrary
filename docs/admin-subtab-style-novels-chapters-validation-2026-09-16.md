# 后台子 tab 样式收口验证记录

日期：2026-09-16
仓库：`E:\Developments\Projects\zhi-zhou`
执行手册：[`admin-subtab-style-novels-chapters-manual-2026-09-16.md`](./admin-subtab-style-novels-chapters-manual-2026-09-16.md)
编制基线：`2e40652a28c2841ed4ca527f2c7c04659ddf0c52`

本文件是**空白执行记录**，在实施开始前不填写任何「通过」。第 1 节为编制期已确认的事实，可直接采信；第 2 节起由执行者在实施过程中逐项填写。

## 1. 编制期已确认事实

以下内容来自编制期对源码、组件与 CSS 的直接核查，不是运行期观测；执行时如有冲突以实际计算样式为准。

### 1.1 执行环境

- 编制基线 SHA：`2e40652a28c2841ed4ca527f2c7c04659ddf0c52`（2026-09-16 20:29:37 +0800，`style(admin): 统一书源批量操作栏`）。
- 工作区在编制期是干净的（`git status --short` 无输出）。
- 仓库根目录与后台目录没有 `AGENTS.md`；`rg --files -g AGENTS.md` 只命中 `node_modules/recharts/AGENTS.md`。
- 提交约定见 `.cursor/rules/commit-language.mdc`：Conventional Commits 英文 type + 中文描述。

### 1.2 编制基线距上一版手册已完成的工作

2026-09-13 版手册的基线是 `75e1d1b`。到本基线之间有 13 个提交、30 个文件、+1472/−496 行已落地：

- `style(admin): 统一后台子 tab 面板与卡片视觉`（`001ab53`）至 `style(admin): 统一书源批量操作栏`（`2e40652`）。
- 涉及 `admin-operations.css`（+966 行区间）、`AdminWorkspace.tsx`、AI/账户/运营/书源/抓取各面板，以及 `tokens.css` 与公开页样式文件的圆角归并。
- 这些成果已计入基线，新手册不重复要求；P0 的基线检查只用于确认它们没有回退。

### 1.3 页面范围与范本

- 导航注册表：5 个分组、9 个一级入口、25 个可导航子页（含范本 2 页）。
- 固定范本：`/admin/novels`（`NovelsTab.tsx`）、`/admin/chapters`（`ChaptersTab.tsx`）。
- 迁移目标：T01–T23，共 23 页。
- 由范本降级为目标的页面：内容审核（T01）、安全策略（T02）。

### 1.4 已存在的标题元数据映射（不需重做）

| 父容器 | 映射常量 | 行号 | 覆盖的子页 |
| --- | --- | --- | --- |
| `AiTab.tsx` | `AI_SUBTAB_META` | `:30` | writing / cover / tasks / content / usage / audit / config / params |
| `scrape/index.tsx` | `SCRAPE_VIEW_META` | `:15` | center / sources / proxy |
| `SettingsTab.tsx` | `ACCOUNT_TAB_META` | `:94` | users / registration / audit / operation-audit |
| `SiteOperationsTab.tsx` | `OPERATION_TAB_META` | `:20` | overview / traffic / content |

`scrape/index.tsx:44-45` 在 `sources` 视图主动把 `title`/`description` 置 `undefined`，由 `SourcesView` 自带页头——这是唯一已正确处理标题归属的案例。

### 1.5 待 P0 处理的已确认缺陷

| 项 | 位置 | 事实 |
| --- | --- | --- |
| 标题不一致 | `JobsTab.tsx:369` vs `admin-registry.ts:63` | 页面写「任务管理」，导航写「任务队列」 |
| 标题不一致 | `ContentPolicyTab.tsx:64` vs `admin-registry.ts:93` | 页面写「内容安全」，导航写「安全策略」 |
| 标题不一致 | `DashboardTab.tsx:76` vs `admin-registry.ts:42` | 页面写「后台总览」，导航写「总览」 |
| 标题不一致 | `AiTab.tsx:37` vs `admin-registry.ts:78` | 子页写「AI 配置」，导航写「配置」 |
| 页内重复标题 | `SettingsTab.tsx:630` | `audit` 子页的 `<h2>登录审计</h2>` 与页标题字面相同 |
| 近似重复标题 | `SettingsTab.tsx:713` | 「管理员操作审计」与页标题「操作审计」近似 |
| 死 import | `ChaptersTab.tsx:23`、`:25` | `AdminContextPanel`、`AdminMetricStrip` 全文件仅 import 处命中 |

### 1.6 结构性缺口（决定各包工作量）

- `SettingsTab.tsx`：4 处裸 `Table`（`:514`、`:639`、`:721`、`:806`）已手写完整 `data-*` 语义，但没有 `AdminDataPanel` 包裹，也没有 `AdminColumn` 常量 → 列宽变量无处注入，`table-layout: fixed` 与 `.admin-data-panel--grid` 卡片化均不生效。
- `scrape/ProxyView.tsx`：`:302` 裸 `Table`，同样已有 `data-*`（1/6/0/0）但无面板契约。
- `ai/AiAuditPanel.tsx:123`、`ai/AiGenerationsPanel.tsx:352`：原生 `<table>` 未走 `AdminDataPanel`，含展开详情行，收敛时不得牺牲展开行。
- 零 workspace 组件页面：`ContentPolicyTab.tsx`、`DashboardTab.tsx`、`ai/AiConfigPanel.tsx`、`ai/AiCoverPanel.tsx`、`ai/AiParamsPanel.tsx`、`ai/AiWritingPanel.tsx`。

### 1.7 契约勘误（相对 2026-09-13 版手册）

- `.admin-data-table` 在 CSS 与 TSX 中**均不存在**；真实选择器是 `.admin-data-panel--grid table`（`admin-operations.css:6770`）。`AdminWorkspace.tsx:176` 注释是过期引用。
- 固定列宽覆盖第 **1–12** 列（`:6775-6822`），不是第 8 列；第 13 列起无规则。
- 固定列宽区间 `@media (min-width: 901px)`（`:6769`）与卡片化 `@media (max-width: 900px)`（`:6935`）成对，分界 900/901。
- `--admin-dialog-radius` 已不存在，现为 `--admin-radius-dialog`（`:22`，值 `--radius-xl` = 16px）。
- `_admin-discover.css` 不存在；`_admin.css`、`_admin-ui.css` 仍在 `global.css:24-25` 导入，且 `.novel-editor__field { margin-bottom: 0 !important }` 由 `_admin-ui.css:13` 覆写 `admin-operations.css:2864` 的同名规则。

### 1.8 命令与脚本现状

web workspace 有 `dev` / `build` / `preview` / `typecheck` / `test`，**没有** lint 或 format script。ESLint 与 Prettier 用仓库根级配置直接调用（`npx eslint`、`npx prettier`）。

## 2. 执行环境（实施时填写）

- 实际起始 SHA：
- 结束时工作区状态：
- 本地服务地址、是否使用 mock：
- 已有改动与保护方式：
- 可访问的真实数据范围：

## 3. 页面清单

状态可用：`pending` / `in-progress` / `implemented` / `verified` / `blocked-auth` / `blocked-data`。
`implemented` 仅表示代码完成；`verified` 需有适用行为和浏览器证据。

| ID | 页面 | 状态 | 变更文件 | 桌面/移动/暗色证据 | 行为验证 | 未验证项 |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | 内容审核 | implemented | `ModerationTab.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、原因槽位切换证据、分页 |
| T02 | 安全策略 | implemented | `ContentPolicyTab.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、开关即时保存实测 |
| T03 | 客户端监控 | implemented | `MobileTelemetryTab.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、状态更新实测 |
| T04 | 用户管理 | implemented | `SettingsTab.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、账号操作与分页 |
| T05 | 注册与邀请码 | implemented | `SettingsTab.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、保存模式与邀请码动作 |
| T06 | 登录审计 | implemented | `SettingsTab.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、查询条件与分页 |
| T07 | 操作审计 | implemented | `SettingsTab.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、筛选值与展开信息 |
| T08 | 任务队列 | implemented | `JobsTab.tsx`、`admin-operations.css`、`_admin-ui.css` | 未执行 | 静态检查通过 | 浏览器视觉、键盘焦点顺序；提交 `8e37b4c` |
| T09 | AI 任务 | implemented | `ai/AiTasksPanel.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、轮询、批次动作 |
| T10 | 调用审计 | implemented | `ai/AiAuditPanel.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、展开详情行、分页 |
| T11 | 已生成内容 | implemented | `ai/AiGenerationsPanel.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、批次展开、深链与长文弹窗 |
| T12 | 抓取中心 | implemented | `scrape/CenterView.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、链接/搜索/榜单入口与发现结果 |
| T13 | 书源管理 | implemented | `scrape/SourcesView.tsx`、`admin-operations.css` | 未执行 | 静态检查通过（含既有 `SourcesView.test.tsx`） | 浏览器视觉、筛选语义与批量动作 |
| T14 | 代理设置 | implemented | `scrape/ProxyView.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、保存/测试/路由检查与日志刷新 |
| T15 | AI 创作 | implemented | `ai/AiWritingPanel.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、切模式保留草稿、前置校验与任务跳转 |
| T16 | 封面生成 | implemented | `ai/AiCoverPanel.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、图片比例与候选选择/应用/弃用 |
| T17 | AI 配置 | implemented | `ai/AiConfigPanel.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、密钥遮罩与测试/保存行为 |
| T18 | 参数调优 | implemented | `ai/AiParamsPanel.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、数值范围/默认值/dirty 状态 |
| T19 | 总览 | implemented | `DashboardTab.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、真实指标与刷新 |
| T20 | 用量统计 | implemented | `ai/AiUsagePanel.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、图表缩放与 tooltip、日期范围切换、空/失败状态 |
| T21 | 运营概览 | implemented | `SiteOperationsTab.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、公告保存与运营信号 |
| T22 | 流量分析 | implemented | `SiteOperationsTab.tsx` | 未执行 | 静态检查通过 | 浏览器视觉、暗色图例/坐标/tooltip 可读性 |
| T23 | 内容分析 | implemented | `SiteOperationsTab.tsx`、`admin-operations.css` | 未执行 | 静态检查通过 | 浏览器视觉、列表详情弹窗与 CSV 导出 |
| T24 | 小说管理（范本回归） | pending | | | | |
| T25 | 章节管理（范本回归） | pending | | | | |

## 3. P0 记录（标题一致性与清理）

执行日期：2026-09-16。基线：`8e37b4c` 之上（T08 已先行完成）。

### 3.1 标题口径决策

§3.4 只要求「导航侧或页面侧二者取一」，未定方向。经确认采用**页标题不变、导航 label 自含化**：内容区主标题独立出现时需自含语义，而导航 label 有分组上下文，可承担更具体字面。

| 文件:行 | 改动 | 依据 |
| --- | --- | --- |
| `admin-registry.ts:42` | `总览` → `后台总览` | 对齐 `DashboardTab.tsx:76` 页标题 |
| `admin-registry.ts:63` | `任务队列` → `任务管理` | 对齐 `JobsTab.tsx:427`；该页含下载日志，「队列」覆盖不全 |
| `admin-registry.ts:78` | `配置` → `AI 配置` | 对齐 `AiTab.tsx:37` 子页标题 |
| `admin-registry.ts:93` | `安全策略` → `内容安全` | 对齐 `ContentPolicyTab.tsx:64` |

`admin-registry.test.ts:18` 的断言随之更新为 `['审核队列', '内容安全']`；`Admin.test.tsx:22` 用的是测试自身 mock 的 labels，不读取真实注册表，无需改动。

### 3.2 页内重复标题

| 位置 | 改动 | 结果 |
| --- | --- | --- |
| `SettingsTab.tsx:630` | `登录审计` → `登录记录` | 不再与 `audit` 子页标题同字面 |
| `SettingsTab.tsx:713` | `管理员操作审计` → `操作记录` | 不再与 `operation-audit` 子页标题近似重复 |

`:506`（用户）、`:776`（邀请码）留待 P2 随该页面板契约一并处理，因它们与页标题并非同字面。

### 3.3 死 import 清理

删除 `ChaptersTab.tsx:23`/`:25` 的 `AdminContextPanel`、`AdminMetricStrip`。基线 ESLint 对这四行报 4 个 `no-unused-vars`（含 `:59`、`:171` 两处既有未使用变量）；清理后剩 2 个，行号平移 `-8` 与删除行数一致。净消除 2 个 error，未引入新问题。

### 3.4 P0 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试） |
| `npm run build --workspace=@zhi-zhou/web` | 通过（保留既有 >500kB chunk 警告） |
| `git diff --check` | 通过 |
| `npx eslint` 五个改动文件 | 2 error（均为既有），5 warning（与基线逐条相同） |
| Impeccable `detect.mjs` | 返回空数组 |

改动规模：5 文件，+9/−17 行。

**未执行**：P0 要求的两个范本已登录浏览器截图（桌面/窄屏/暗色/弹窗计算样式复核）。故 P0 标题项为静态完成，浏览器证据缺失。

### 3.5 执行偏差记录

首次对 `SettingsTab.tsx` 运行 `npx prettier --write` 造成 506/425 行全文件重排——该文件从未符合 Prettier，格式化淹没了 2 行真实改动。已 `git checkout --` 回滚并用精确编辑重做，diff 收敛至 2 行。**结论：仓库未统一的文件不得整体格式化**；后续包只对已符合 Prettier 的文件运行 `--write`。

### 3.6 迁移进度

第 2 节状态表初始为全部 `pending`，其中 T08 已由提交 `8e37b4c` 完成（`implemented`，非 `verified`）。其余 T01–T07、T09–T25 维持 `pending`，从 P1 起按手册执行包逐包推进。

## 3A. P1 记录（审核、安全策略、客户端监控）

执行日期：2026-09-16。前置提交：`2a46ec8`。

### 3A.1 内容审核（T01）

页面已具备工具栏/数据面板/面板标题三段结构，`moderation-toolbar`（`:584`）位于数据面板之外，符合手册 §4.1 对多条件筛选页的规定，位置不动。

核对三套列定义与表头顺序：`thoughts` 8 列、`comments` 7 列、`reports` 7 列，宽度分别合计 100%，`MODERATION_COLUMNS` 与 `cfg.head` 逐项对应，无错配。唯一的偏差是操作列表头字面为空字符串，而范本用「操作」；三处 `head` 末项改为「操作」。

其余改动：`thead` 补 `scope="col"`（原已具备）与 `TableCaption className="sr-only"`；页头 `meta` 的 fallback 由 `'审核队列'` 改为 `'读取中'`，避免与面板语义重复。

空状态未改造：`AdminEmptyState` 只接受 `message`，而该页空态需要「标题 + 说明 + `role=alert/status`」三段，与监控页不同构。按手册 §5「只有至少两个目标页面存在相同结构需求时才扩展共享能力」，保留页面自有的 `.moderation-empty`（其 `--error` 变体样式已存在）。

### 3A.2 安全策略（T02）

保持单面板与 `max-w-3xl`（48rem）的可读宽度，宽度改由页面命名空间 CSS 承担（`.content-policy-panel`），未扩大页面宽度。开关行与状态文字抽出 `.content-policy-row`、`.content-policy-status` 一组类，圆角取 `--radius-lg`（12px，与原 `rounded-lg` 一致），底色按原 `bg-muted/30` 折算为 `--admin-panel-muted` 40% 透明。

状态文字补了 `saving` 分支（原实现只在 `loading` 与最终态之间二选一，保存中没有反馈）。未添加保存按钮：该页是即时保存，手册 §4.5 明确要求保持不变。

### 3A.3 客户端监控（T03）

手册指明的三处缺口全部处理：

| 缺口 | 处理 |
| --- | --- |
| 工具栏裸 `<select>`（原 `:146`）与裸 `<Input>`（`:155`） | 换成 `CustomSelect` + `AdminSearch`；旧 CSS 的 `> select` 与 `[data-slot='input']` 选择器同步改为 `[data-slot='button'][role='combobox']` 与 `.admin-search` |
| 行内裸 `<select>`（原 `:69`） | 换成 `CustomSelect`，保留原有 `aria-label` 语义 |
| 高频事件区裸 `div`（原 `:192`） | 升为 `.admin-panel-card` + `AdminPanelHeading` 的面板表面 |

`data-actions` 一项**未按手册填 0 缺口处理**：该列是每行唯一的状态变更入口，但它是带真实表头标签的字段列而非操作按钮列；`data-actions` 在移动端会隐藏列标签并把内容贴到卡片底部，用于此列反而丢失「处理状态」语义。故保留为普通字段（`data-label="处理状态"`），列宽由 `8rem` 调为 `9rem` 容纳 `CustomSelect`。

其余：页头保留刷新按钮（`load()` 同时刷新指标条、事件列表与高频事件，是页面级操作，不宜下沉到面板）；加载态保留原居中占位框而非换成 `AdminEmptyState`（加载中不是空状态）；事件表补 `TableCaption` 与 `scope="col"`。

### 3A.4 P1 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试） |
| `npm run build --workspace=@zhi-zhou/web` | 通过 |
| `git diff --check` | 通过 |
| `npx eslint` 三个改动页面 | 4 warning（均为既有 `set-state-in-effect`），无 error、无未使用导入 |
| Impeccable `detect.mjs` | 返回空数组 |
| Prettier | `ContentPolicyTab.tsx`、`MobileTelemetryTab.tsx` 不符合；已用 HEAD 版本探针确认两文件在修改前就有 16 / 77 行差异，属既存问题，未整体格式化 |

改动规模：4 文件，+269/−59 行。

**未执行**：手册 P1 退出标准要求的移动端可用性实测、条件切换与分页语义实测、审核「原因」槽位手动切换证据，以及三页的浏览器视觉复核。故 T01–T03 记 `implemented`，非 `verified`。

## 3B. P2 记录（账户四视图）

执行日期：2026-09-16。前置提交：`2c90dce`。本包集中改 `SettingsTab.tsx` 一个文件（881 → 924 行）。

### 3B.1 结构性改造

四个视图此前各自手写 `admin-data-panel admin-data-panel--grid <panel>` 容器、手写 `account-settings-panel__header` 标题条、并用一层 `<div className="overflow-x-auto">` 包表格，均无 `AdminColumn` 常量，列宽只在 CSS 里以 `--col-N-w` 声明。

改为：

- 新增 `USER_COLUMNS`、`LOGIN_AUDIT_COLUMNS`、`OPERATION_AUDIT_COLUMNS`、`INVITE_COLUMNS` 四组列定义，宽度取原 CSS 中的百分比原值，改由 `<AdminDataPanel columns>` 注入。
- 四处 `<section …admin-data-panel…>` 换成 `<AdminDataPanel>`，`overflow-hidden` 保留（范本 `ChaptersTab.tsx:502`、`JobsTab.tsx:447` 同样显式添加，用于裁剪 20px 圆角内的表格）。
- 四处标题条换成 `AdminPanelHeading`，标题改为工作对象名（用户目录／登录记录／操作记录／邀请码），描述与状态胶囊归位到 `description`／`status`。
- 删除四处冗余的 `overflow-x-auto` 包裹层：shadcn `Table` 自带 `data-slot="table-container"` 且已是 `overflow-x-auto`（`table.tsx:9-12`），外层包裹重复。登录审计视图还多一层无类名 `<div>`，一并移除。
- 四处表格补 `TableCaption className="sr-only"` 与表头 `scope="col"`（原有 25 处表头全部补齐）。
- 页脚（共 N 条 + 分页）抽出 `.account-settings-panel__footer` / `__pager`，替代三处手写的 `border-t …` 组合。

### 3B.2 指标条去 Card 包裹

手册要求「现有指标条避免 Card 再包指标条」。核对其他页面：`MobileTelemetryTab.tsx:150`、`AiUsagePanel.tsx:84`、`DashboardTab.tsx:90`、`SiteOperationsTab.tsx:192` 的指标条**均为无 Card 直接放置**，账户视图是唯一例外。已移除 `Card + CardHeader + CardContent` 包裹。

随之发现一处既存的类名语义冲突：`.admin-metric-strip--account` 被并入 `.admin-panel-heading` 同组规则，带 `display: flex` + `border-bottom`，即该页指标条此前被当作「Card 内标题条」渲染；而同一类名在窄屏规则（`:7017`）里又按网格处理。移除 Card 后这种双重语义会直接导致视觉失真。已把该类从 heading 组中拆出，改为标准指标条外观并声明 `--admin-metric-columns: 4`，与客户端监控页一致。

### 3B.3 死规则清理

改造后 `account-settings-panel__header`（两处）与 `account-settings-toolbar` 零消费者，连同 `--col-N-w` 的四处声明一并删除，避免同一份宽度在 JSX 与 CSS 两处各写一遍。按手册 §5 修正原规则，未在文件末尾追加覆盖。

### 3B.4 P2 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试） |
| `npm run build --workspace=@zhi-zhou/web` | 通过 |
| `git diff --check` | 通过 |
| `npx eslint SettingsTab.tsx` | 0 error / 3 warning（既有 `set-state-in-effect`） |
| Impeccable `detect.mjs` | 返回空数组 |

结构核验：`<AdminDataPanel>` 4 处、`<AdminPanelHeading>` 4 处、`<TableCaption>` 4 处、`scope="col"` 25 处；`admin-data-panel--grid` 手写、`overflow-x-auto`、`account-settings-panel__header`、`account-settings-toolbar` 残留均为 0。

改动规模：2 文件，+317/−253 行。

**未执行**：手册 P2 要求的账号操作（重置密码、禁用、删除）、保存模式原时机、邀请码状态、查询条件与分页、审计展开信息的浏览器实测。故 T04–T07 记 `implemented`，非 `verified`。

## 3C. P3 记录（AI 任务与生成内容）

执行日期：2026-09-16。前置提交：`51fc94d`。本包处理 T08 之外的 T09–T11，即 `ai/` 下三个面板（172 / 276 / 661 行）。

### 3C.1 共享状态胶囊抽取（跨包修正）

执行中核对到一处既存重复：面板标题旁的状态胶囊在五个页面各写了一份**逐字相同**的规则体（含 `is-error` 变体），见改造前的 `.jobs-list-status`、`.account-list-status`、`.mobile-telemetry-status`、`.moderation-list-status`，而本包正要再加第五份。

手册 §5 的门槛是「至少两个页面存在相同结构需求」。五处逐字相同已远超门槛，故抽为共享类 `.admin-panel-status`（含 `.is-error`），删除四处页面副本，并同步更新 `JobsTab.tsx`、`SettingsTab.tsx`、`MobileTelemetryTab.tsx`、`ModerationTab.tsx` 的类名。该类与 `AdminPanelHeading` 的 `status` 槽位配套，是这一槽位唯一的样式来源。替换后旧类名残留 0 处，新类名 8 处。

### 3C.2 三面板改造

- `AiTasksPanel`：`Card`+`CardHeader` 换成 `AdminDataPanel`+`AdminPanelHeading`，标题由「AI 任务管理」改为工作对象名「任务列表」，与页标题「AI 任务」不再同字面。空态改用 `AdminEmptyState`，替掉手写的高度居中 `div`。
- `AiAuditPanel`：删掉 `:121` 自写的 `rounded-xl border` 容器与 `:123` 内层 `overflow-x-auto`，外框与滚动边界改由 `.ai-audit-table` 承担；`Card` 换面板，标题由「调用记录」保留（与页标题「调用审计」不同字面）。补齐 `<caption class="sr-only">` 与表头 `scope="col"`，数值列加 `.is-numeric` 统一右对齐。
- `AiGenerationsPanel`：容器换面板，标题改为「生成内容」（页标题为「已生成内容」）；空态改用 `AdminEmptyState`；补 `caption` 与 `scope="col"`。

### 3C.3 展开行的处理（手册 §4.4 与 P3 保留项）

P3 表格明确要求「该表含展开详情行，必须保留」「不能为卡片化牺牲展开行」。核对 `.admin-data-panel--grid` 的移动端实现（`admin-operations.css:7457` 起）后确认：900px 以下它按 `data-label`/`data-primary`/`data-actions` 把每个 `td` 折成独立字段行，而 `tbody` 中**没有任何 `colspan` 处理**（全文件搜 `colspan` 无 CSS 命中）。因此含 `colSpan={6}` 详情行的表若挂上 `--grid`，详情行会被拆成错配字段。

故两张表**不传 `columns`**，即不加 `.admin-data-panel--grid`：外框与标题走共享面板，表格保持原生结构。`.ai-generations-table` 原有的一套约 140 行移动端卡片规则（`:4601-4740`，含 `grid-template-areas` 与批次子行处理）继续生效，本包未改动它。

改造中曾一度重写该表的 `<thead>`/`<td>` Tailwind 类并引入 `.ai-generations-table__table`，这会使上述既有移动端规则失去依托。已回退：`<table>` 恢复原 `w-full min-w-[760px] text-sm`，表头恢复原显隐类，仅保留新增的 `scope` 与 `caption`；自建的失效选择器一并删除。

### 3C.4 死规则清理

改造后零消费者并已删除：`.ai-audit-card-header`、`.ai-generations-card__header`（宽屏与 640px 两处）、`.ai-generations-card__filter` 系列、`.ai-service .ai-audit-panel > [data-slot='card-content'] > div.overflow-hidden`（依赖已被移除的 Card 结构）。

`admin-operations.css` 中原有的 `.ai-list-footer` 系列此前只承担横向滚动与字号，布局靠 JSX 的 Tailwind 类；本包把布局职责（`display`/`gap`/`margin-left: auto` 与 900px 堆叠）合并进原规则，未在文件末尾追加同名覆盖。

### 3C.5 P3 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试） |
| `npm run build --workspace=@zhi-zhou/web` | 通过 |
| `git diff --check` | 通过 |
| `npx eslint`（三个面板） | 0 error / 4 warning，均为既有 `set-state-in-effect` |
| Impeccable `detect.mjs` | 返回空数组 |

标题核验：面板标题「任务列表」「调用记录」「生成内容」与页标题「AI 任务」「调用审计」「已生成内容」均不同字面。

**未执行**：AI 任务轮询与批次跳转、调用审计展开详情行在 900px 下的表现、批次展开与 `/admin/ai?sub=content&batch=...` 深链在刷新与后退后的上下文保持、长文弹窗。故 T09–T11 记 `implemented`，非 `verified`。

## 3D. P4 记录（抓取三视图）

执行日期：2026-09-16。前置提交：`245376b`。本包处理 T12–T14。抓取中心的标题归属已正确（`index.tsx:44` 对 sources 传 `undefined`，由 `AdminTabHeader` 自持），保持只读。

### 3D.1 代理设置（T14）

手册点名 `:302` 的裸 `Table`。原结构为 `Card className="admin-panel-card proxy-logs-panel admin-data-panel--grid"` 手写 grid 类而无 `columns`，列宽无来源；表内用 `colSpan={6}` 行承载加载态与空态。

改造：容器换成 `AdminDataPanel` + `columns={LOG_COLUMNS}`（六列，宽度合计 100%，目标列 `primary`），标题条换成 `AdminPanelHeading`，刷新按钮移到 `actions`；加载态与空态改用 `AdminEmptyState` 置于表格外，替掉原先的 `colSpan` 行——这与任务队列范本（`JobsTab.tsx:523-559`）一致，也避免跨列行在移动卡片模式下错配。

配置与测试两个面板按手册 §4.5「表单保持 Card」保留 `Card`，仅把标题条换成 `AdminPanelHeading` 并去掉其自带外边距与分隔线，避免与 `CardContent` 留白叠加；`CardHeader`/`CardTitle`/`CardDescription` 随之成为死导入并移除。补齐 `caption`、表头 `scope="col"`（范本只在 `TableHead` 用 `scope`，`data-label` 仅出现在 `TableCell`）。

### 3D.2 书源管理（T13）

该表 10 列，用 `colgroup` 自管百分比列宽并配 `min-width: 1200px` 与 `.source-panel__scroll-hint` 的横向滚动提示；`SourcesView.test.tsx` 断言 `.source-panel__table-wrapper[aria-busy]` 与筛选后的滚动位置。

因此**未**改用 `columns`/`--grid`：那会由 `--col-N-w` 与 `colgroup` 双重定义宽度，并让 900px 以下的卡片折叠接管、取消既有的横向滚动语义。改为把外层手写的 `<section className="source-panel" aria-label>` 换成 `AdminDataPanel`（同样渲染 `<section aria-label>`，语义等价），补齐 `caption` 与 10 处表头 `scope="col"`。

随之发现一处既存的失效覆盖：`.admin-data-panel`（`:5358`）与 `.source-panel`（`:4136`）特异性相同而后者先定义，故 `border: 0` 与 20px 圆角生效，`.source-panel` 原写的 `border: 1px solid` 与 `--radius-xl`（16px）全部落空；`:5905` 的 sources 作用域覆盖同样被压成 16px，与章节目录范本的 20px 不一致。按手册 §5 修正这两处原规则，而非追加新的覆盖。

### 3D.3 抓取中心（T12）

`:593`/`:594` 已用 `AdminDataPanel`/`AdminPanelHeading`，本包未改动该文件。

### 3D.4 P4 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试，含 `SourcesView.test.tsx`） |
| `npm run build --workspace=@zhi-zhou/web` | 通过 |
| `git diff --check` | 通过 |
| `npx eslint`（ProxyView、SourcesView） | 0 error / 1 warning（既有 `set-state-in-effect`） |
| Impeccable `detect.mjs` | 返回空数组 |

页头核验：抓取中心与代理设置由父级渲染页标题，书源管理由 `AdminTabHeader` 自持；面板标题为「配置迁移」「书源目录」「导入书源」「最近出站日志」「HTTP / HTTPS 出站代理」「代理连通性测试」，与页标题「抓取中心」「书源管理」「代理设置」均不同字面，无重复页头。

**未执行**：链接/搜索/榜单入口、发现结果、作品确认、章节校验、抓取配置与开始任务；书源导入、连接检测、批量启停删与编辑测试弹窗；代理保存草稿/有效值区别、连通测试、路由检查与日志刷新的浏览器实测。故 T12–T14 记 `implemented`，非 `verified`。

## 3E. P5 记录（生成与配置）

执行日期：2026-09-16。前置提交：`0b54ccd`。本包处理 T15–T18，四个文件共 2266 行。

### 3E.1 页面类型判定

手册要求「先判定页面类型再套语言」。核对四个文件的渲染骨架后确认：四页**均无数据表格**，全部是表单 + 分组卡片（输入、下拉、开关、文本域、保存按钮），故按手册 §4.5 一律保留 `Card`/`CardContent`，不引入 `AdminDataPanel`/`AdminColumn`。改造落在标题条语言与字面去重上。

### 3E.2 标题去重

页标题由 `AiTab.tsx:31-38` 提供。两处原面板标题与页标题近义重复：`AI 创作工作台`（页标题「AI 创作」）、`AI 封面生成`（页标题「封面生成」）。改为工作对象名：`创作工作台`、`封面生成工作台`。`AI 配置` 页的 `模型供应商`/`读者生成策略`/`服务检查与用量` 与 `参数调优` 页的六组参数标题本就不同字面，保持不变。

### 3E.3 标题条统一

四个文件共 12 处 `CardHeader`+`CardTitle` 换成 `AdminPanelHeading`（标题、描述、状态/动作归位到对应槽位），使后台各页标题语言一致。随之移除各文件的 `CardHeader`/`CardTitle` 死导入。AI 创作页的「新写/续写」模式选择器移入 `AdminPanelHeading` 的 `actions` 槽位，原位置与标题同级。

### 3E.4 共享层与既有规则的连带修正

改造中核到两类跨页重复，均按手册 §5 提到共享层或修正原规则，而非逐页新增覆盖：

`admin-panel-title`：标题内嵌图标的写法在后台共 24 处（AI 配置 3、参数调优 6、站点运营 12、内容安全 1 等），远超「两个页面」门槛。P4 中我最初按页面命名空间写成 `.proxy-panel-title`，本包改为共享类 `.admin-panel-title` 并同步代理设置的两处引用。

`:has(> [data-slot='card-header'])`：该规则把带标题条的卡片 `padding` 归零，使标题区能从卡片边缘铺满。`CardHeader` 换成 `AdminPanelHeading` 后条件失配，卡片会重新拿到 `padding: var(--admin-space-5)`，与 `CardContent` 叠加成双层内边距。已把条件扩展为 `:has(> [data-slot='card-header'], > .admin-panel-heading)`。核对既有 17 处 `AdminPanelHeading` 消费者后确认安全：其中 `mobile-telemetry-top-events` 本就 `padding: 0`，结果不变；其余均由 `AdminDataPanel` 承载，不受该规则影响。

`.ai-params-card [data-slot='card-header']` 与 `.ai-writing-panel .ai-writing-header [data-slot='tabs-list']`：两条规则分别按 `card-header` 与 `ai-writing-header` 选择器定制内边距与标签高度，换标题条后会失效。已按新结构修正为 `.ai-params-card > .admin-panel-heading`、`.ai-writing-panel .admin-panel-heading [data-slot='tabs-list']`。

随后发现 P4 遗留问题并一并纠正：当时为代理设置的配置与测试卡片补过两条 `.proxy-*` 覆盖规则，在新的 `:has` 条件下已属多余（`padding: 0` 已由共享规则提供，标题条默认内边距正是范本行为），继续存在会让标题贴边。已删除这两条自加的覆盖。

### 3E.5 P5 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试，含 `AiWritingPanel.test.tsx`） |
| `npm run build --workspace=@zhi-zhou/web` | 通过 |
| `git diff --check` | 通过 |
| `npx eslint`（四页 + ProxyView） | 0 error / 7 warning，均为既有 `set-state-in-effect` |
| Impeccable `detect.mjs` | 返回空数组 |

接口 payload 核验：对四页 diff 检索 `aiApi.`/`novelsApi.`/`chaptersApi.` 等调用行，无任何命中，即 payload 未发生变化。

**未执行**：AI 创作切模式是否保留草稿、前置校验与生成阶段、现有任务跳转；封面比例的图片预览与候选选择/应用/弃用；密钥遮罩与「空密钥不等于清空」的行为；参数范围、默认值、枚举与 dirty 状态；暗色弹层与长表单滚动的浏览器实测。故 T15–T18 记 `implemented`，非 `verified`。

## 3F. P6 记录（统计与运营）

执行日期：2026-09-16。前置提交：`0cf98cd`。本包处理 T19–T23：总览、用量统计与运营三个 view（overview/traffic/content），共 4 个文件。

### 3F.1 页面类型判定

手册要求「先判定页面类型」。三处均为统计展示型：总览是「指标条 + 状态条 + 两个只读列表」；用量统计是「指标条 + 两个 Recharts 图表面板 + 区间切换」；运营台是「指标条 + 多个展示卡片 + 一个详情弹窗」。均**无数据表格**，故按手册 §4.5 保留 `Card`，只统一标题条为 `AdminPanelHeading`。

### 3F.2 总览（T19）

`STAT_CARDS` 7 项与 `AdminMetricStrip` 内联注入的列数一致，指标本身未动。原「任务状态」块与两个列表是手写 `div.admin-panel-card` + 一层冗余的 `CardContent > div`，改为 `AdminDataPanel` 承载语义（`ariaLabel` 为「抓取任务状态」「最近抓取任务」「最近更新小说」）。列表的标题条由 `CardHeader` 换成 `AdminPanelHeading`，右侧的说明文字改走 `status` 槽位。

修正既存的失效 token：列表头原用 `text-muted`，而 Tailwind 4 里该类解析到 `--color-muted` → `--sh-muted` → `--bg-secondary`，是**背景色**而非文字色，实际渲染为近不可见；已改为 `text-muted-foreground`。

状态呈现按手册 §4.6 区分：首屏失败用 `ErrorState`（带就地重试，此前是无重试的裸 div），加载中用 `LoadingState`，列表为空用 `AdminEmptyState`，三者在代码里可辨。

### 3F.3 用量统计（T20）

两个图表面板换成 `AdminDataPanel` + `AdminPanelHeading`，区间切换（7/30/90 天）进入标题条的 `actions` 槽位。原有的三种状态改由组件表达，并把「暂无数据」拆成「所选范围内没有 AI 调用记录 / 没有 Token 用量记录」，符合手册 §4.6 对「筛选无结果」与「请求失败」的区分。

**未**给图表面板加 `overflow-hidden`：手册明确要求不让 tooltip 被新增 overflow 裁剪，Recharts 的 tooltip 渲染在图表容器内，加裁剪会切掉它。两个图表的 `h-80`/`h-64` 固定高度与 `ResponsiveContainer width="100%"` 未动，容器链上保留了 `min-w-0`。

### 3F.4 运营三视图（T21–T23）

12 处 `CardHeader` + `CardTitle` 换成 `AdminPanelHeading`，其中「更新趋势」的区间按钮与「更新活跃度」的「查看全部更新作品」移入 `actions`。页标题仍由 `OPERATION_TAB_META` 按 view 提供（手册 §3.4 已确认完成，未重做）。CSV 导出的 8 段 `rows.push` 结构、`Blob`/`\uFEFF` 前缀与文件名模板逐字未动；作品详情弹窗、分页与「管理」跳转的 handler 未动。

### 3F.5 清理的失效 CSS

指标条列数上存在一条完整失效链，本包一并查清并收口。`AdminMetricStrip` 用**内联 style** 注入 `--admin-metric-columns`（`AdminWorkspace.tsx:97`，跟随 `items.length`），内联声明优先于本文件所有同名规则，故以下五处覆盖全部从未生效：

`.admin-metric-strip--ai-usage`（`:228`）、`.admin-metric-strip--dashboard`（7）、`.admin-metric-strip--account`（4）、`.admin-redesign-page--site-operations .admin-metric-strip`（5）与 `.site-operations__metrics:not(.admin-metric-strip--five)`（4）。已全部删除，列数契约统一交回组件；三个变体类名在 TSX 中保留为语义钩子，CSS 侧归零。窄屏覆盖（`@media (max-width: 640px)` 的 `repeat(2, …)`）是直接改 `grid-template-columns`，不受内联变量影响，故保留。

另删三处确认无消费者的规则：`.site-operations__metric`（单数，4 条）在迁移到 `AdminMetricStrip` 后已零 TSX 引用；`.site-operations__metrics--five` 的类名在 TSX 中不存在，其 `@media (min-width: 641px)` 规则永不命中；同一组 640px 规则里对 `--dashboard`/`--account` 的冗余列举（基础类名 `.admin-metric-strip` 已覆盖全部变体）。

需要说明一处推理纠正：中途我曾判断 `.site-operations__metrics` 的 `repeat(4, …)` 会因特异性相同且先定义而**压过** `.admin-metric-strip` 的列数变量、导致 5 项指标挤出。核对行号后确认相反——`.admin-metric-strip` 定义在 `:6799`，位于该规则之后，列数变量本就胜出，不存在该 bug。当时误删了仍然生效的 `gap: 1px`（指标条发丝分隔线的唯一来源，`.admin-metric-strip` 未定义 `gap`），已在本包内恢复。

### 3F.6 P6 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck --workspace=@zhi-zhou/web` | 通过 |
| `npm run test --workspace=@zhi-zhou/web` | 通过（20 文件 / 68 测试） |
| `npm run build --workspace=@zhi-zhou/web` | 通过 |
| `git diff --check` | 通过 |
| `npx eslint`（三个文件） | 0 error / 3 warning，均为既有 `set-state-in-effect` |
| Impeccable `detect.mjs` | 返回空数组 |

契约核验：对三文件 diff 检索 `adminApi.`/`novelsApi.`/`aiApi.`/`link.download`/`rows.push`，无任何命中，即接口 payload、CSV 导出结构与单位未变。指标项数与列数逐个核对：总览 7 项（列数 7）、用量统计 4 项、运营 overview 5 项 / traffic 4 项 / content 5 项，均由组件按项数注入。

**未执行**：三页在 1440/1024/901/900/390 各宽度的浏览器实测；图表在缩放与切 view 后是否保持非零宽度、tooltip 是否被裁剪；暗色下图例、坐标文字与 tooltip 的可读性；公告保存与清除；内容分析的作品详情弹窗、分页与 CSV 实际下载；列表在长文本下的截断表现。故 T19–T23 记 `implemented`，非 `verified`。

## 4. 范本回归

- 小说管理 `/admin/novels`：
- 章节管理 `/admin/chapters`：

回归关注点：页头结构与标题、工具栏位置、面板表面与圆角、`data-*` 字段契约、移动端卡片化、弹窗三段式与焦点返回、`prefers-reduced-motion`。

## 5. 共享层变更

- `AdminWorkspace.tsx`：无改动。未新增共享组件或 props。
- `admin-operations.css`：新增 `.admin-panel-status`（共享，替代五处逐字相同的页面状态胶囊，消费者 8 处）、`.admin-panel-title`（共享，标题内嵌图标，后台共 24 处同类写法）、`.ai-service-stack`、`.ai-list-body`、`.ai-audit-table*`、`.ai-audit-row*`、`.ai-audit-cell__*`、`.ai-audit-detail*`、`.ai-tasks-panel .ai-tasks-content`，以及账户、内容安全、客户端监控三处的页面命名空间规则；修正十一处失效或冲突的规则：`.mobile-telemetry-toolbar > select` 与 `[data-slot='input']` 选择器、`.admin-metric-strip--account` 的 heading 组归属、`.source-panel` 与 `.admin-redesign-page--sources .source-panel` 的失效边框与圆角、`:has(> card-header)` 的 padding 归零条件扩展、`.ai-params-card [data-slot='card-header']` 系列、`.ai-writing-panel .ai-writing-header [data-slot='tabs-list']`、五处被内联变量压过的 `--admin-metric-columns` 覆盖；并把 `.ai-list-footer` 的布局职责合并进原规则；删除 `--col-N-w` 四处、`account-settings-panel__header`、`account-settings-toolbar`、`.ai-audit-card-header`、`.ai-generations-card__header`、`.ai-generations-card__filter` 系列、`.site-operations__metric`（单数，4 条）、`.site-operations__metrics--five` 与 640px 组的冗余变体列举等死规则。
- `tokens.css`：无改动。
- 是否新增共享 class 或 token，以及其消费者：未新增 token。`.admin-panel-status` 为共享类，消费者为 `JobsTab.tsx`（2）、`SettingsTab.tsx`（4）、`MobileTelemetryTab.tsx`（1）、`ModerationTab.tsx`（1）、`AiAuditPanel.tsx`、`AiGenerationsPanel.tsx`、`AiTasksPanel.tsx`，共 8 处；`.admin-panel-title` 为共享类，消费者为 `AiConfigPanel.tsx`（3）、`AiParamsPanel.tsx`（6）、`ProxyView.tsx`（2），新增后站点运营与内容安全的同类写法仍待 P6/P7 一并对齐；`.ai-service-stack`/`.ai-list-body`/`.ai-audit-*` 为 AI 命名空间，消费者为 `AiAuditPanel.tsx` 与 `AiGenerationsPanel.tsx`；其余新增 class 均为单页命名空间。

## 6. 命令结果

| 阶段 | 命令 | 结果 | 关键输出/备注 |
| --- | --- | --- | --- |
| P0 基线 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | `tsc --noEmit` 无输出 |
| P0 基线 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试 |
| P0 基线 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P0 基线 | `git diff --check` | 通过 | 无空白问题 |
| P0 | `npx eslint`（5 个改动文件） | 2 error / 5 warning | 均为既有；基线为 4 error，本次净消除 2 |
| P0 | Impeccable `detect.mjs --json` | 空数组 | 无机械检出 |
| P1 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 无输出 |
| P1 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试 |
| P1 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P1 | `npx eslint`（3 个改动页面） | 0 error / 4 warning | warning 均为既有 `set-state-in-effect` |
| P1 | Prettier 探针 | 2 文件不符 | HEAD 版即已有 16 / 77 行差异，属既存 |
| P2 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 无输出 |
| P2 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试 |
| P2 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P2 | `npx eslint SettingsTab.tsx` | 0 error / 3 warning | warning 均为既有 `set-state-in-effect` |
| P2 | Impeccable `detect.mjs --json` | 空数组 | 无机械检出 |
| P3 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 无输出 |
| P3 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试 |
| P3 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P3 | `npx eslint`（AI 三面板） | 0 error / 4 warning | warning 均为既有 `set-state-in-effect` |
| P3 | Impeccable `detect.mjs --json` | 空数组 | 无机械检出 |
| P4 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 无输出 |
| P4 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试（含 `SourcesView.test.tsx`） |
| P4 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P4 | `npx eslint`（抓取两视图） | 0 error / 1 warning | warning 为既有 `set-state-in-effect` |
| P4 | Impeccable `detect.mjs --json` | 空数组 | 无机械检出 |
| P5 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 无输出 |
| P5 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试（含 `AiWritingPanel.test.tsx`） |
| P5 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P5 | `npx eslint` | 0 error / 7 warning | warning 均为既有 `set-state-in-effect` |
| P5 | Impeccable `detect.mjs --json` | 空数组 | 无机械检出 |
| P6 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 无输出 |
| P6 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 20 文件 / 68 测试 |
| P6 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 保留既有 >500kB chunk 警告 |
| P6 | `npx eslint`（三页） | 0 error / 3 warning | warning 均为既有 `set-state-in-effect` |
| P6 | Impeccable `detect.mjs --json` | 空数组 | 无机械检出 |
| 每包结束 | | | |
| P7 最终 | | | |

## 7. 浏览器验证边界

- 已覆盖的视口与主题：
- 未覆盖的视口与主题（及原因）：
- 未执行的写操作（保存、删除、停用、重放、代理测试、AI 生成、抓取任务、CSV 导出）：
- 未打开的弹窗与焦点返回检查：
- 使用的数据来源（真实 / mock / 测试实例）及切换方式：

## 8. 例外与遗留

1. 页面、原因、影响、下一步：
