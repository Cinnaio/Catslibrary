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
| T04 | 用户管理 | pending | | | | |
| T05 | 注册与邀请码 | pending | | | | |
| T06 | 登录审计 | pending | | | | |
| T07 | 操作审计 | pending | | | | |
| T08 | 任务队列 | implemented | `JobsTab.tsx`、`admin-operations.css`、`_admin-ui.css` | 未执行 | 静态检查通过 | 浏览器视觉、键盘焦点顺序；提交 `8e37b4c` |
| T09 | AI 任务 | pending | | | | |
| T10 | 调用审计 | pending | | | | |
| T11 | 已生成内容 | pending | | | | |
| T12 | 抓取中心 | pending | | | | |
| T13 | 书源管理 | pending | | | | |
| T14 | 代理设置 | pending | | | | |
| T15 | AI 创作 | pending | | | | |
| T16 | 封面生成 | pending | | | | |
| T17 | AI 配置 | pending | | | | |
| T18 | 参数调优 | pending | | | | |
| T19 | 总览 | pending | | | | |
| T20 | 用量统计 | pending | | | | |
| T21 | 运营概览 | pending | | | | |
| T22 | 流量分析 | pending | | | | |
| T23 | 内容分析 | pending | | | | |
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

## 4. 范本回归

- 小说管理 `/admin/novels`：
- 章节管理 `/admin/chapters`：

回归关注点：页头结构与标题、工具栏位置、面板表面与圆角、`data-*` 字段契约、移动端卡片化、弹窗三段式与焦点返回、`prefers-reduced-motion`。

## 5. 共享层变更

- `AdminWorkspace.tsx`：无改动。未新增共享组件或 props。
- `admin-operations.css`：仅新增页面命名空间 `.content-policy-*` 与 `.mobile-telemetry-*` 规则；同时修正两处已失效的选择器（`.mobile-telemetry-toolbar > select`、`.mobile-telemetry-toolbar [data-slot='input']` → `[data-slot='button'][role='combobox']`、`.admin-search`），覆盖宽屏与 900px 两个媒体查询内的同名规则，未在文件末尾追加。
- `tokens.css`：无改动。
- 是否新增共享 class 或 token，以及其消费者：未新增 token。新增 class 均为单页命名空间，消费者分别为 `ContentPolicyTab.tsx`（`.content-policy-row`、`.content-policy-row__copy/__label/__hint`、`.content-policy-status`、`.content-policy-panel`）与 `MobileTelemetryTab.tsx`（`.mobile-telemetry-toolbar__label/__search`、`.mobile-telemetry-loading`、`.telemetry-properties` 及 `__summary/__body/__note`、`.telemetry-status-cell`、`.telemetry-status-select`、`.mobile-telemetry-status`、`.mobile-telemetry-top-events` 及 `__list`），各一个消费者，符合手册 §5 对单页问题的命名空间要求。

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
