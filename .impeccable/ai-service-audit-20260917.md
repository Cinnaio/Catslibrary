# AI 服务前端样式审计

- **目标**：`web/src/pages/admin/AiTab.tsx` 与 `web/src/pages/admin/ai/*`（8 个子面板：创作 / 封面生成 / AI 任务 / 已生成内容 / 用量统计 / 调用审计 / AI 配置 / 参数调优）
- **模式**：Operate（运营台任务完成型表面 —— 可扫描性、一致性、原生预期优先于表达）
- **日期**：2026-09-17
- **方法**：真实 dev server（`http://localhost:5173`）+ 真实 API（`http://127.0.0.1:8787`，管理员会话）；8 面板 × 4 视口 × 2 主题共 64 张截图；5 轮 DOM 计算样式探针（溢出 / 触控尺寸 / 异常盒模型 / 键盘可达性 / 对比度 / reduced-motion 实况）；impeccable detector 静态扫描；`tsc --noEmit` 与 `eslint` 基线；对 `admin-operations.css` 做括号感知的 @media 归属解析（逐条验证断点，避免行号漂移与归属误判）。

> **证据口径说明**：本报告所有行号均经脚本重解析验证。审计时 `admin-operations.css` 为纯 LF 单行结尾、8164 行、199030 字节；该文件含 49 个 `@media` 块，其中 16 个是 `max-width: 900px`，且 AI 相关规则分散在 5 个不同块中 —— 这是本次审计最关键的结构性事实。（该文件在修复过程中增长至 8342 行 / 204548 字节、51 个 `@media` 块、17 个 900px 块，行号引用已随之下移，见下方修订记录。）

---

## 修订与落地记录（2026-09-17 同日复核）

本报告发布后按发现逐项修复，修复过程中**用实测修正了报告自身的 5 处结论**。诚实记录如下，后续读者请以本节为准。

| 报告原结论 | 实测修正 | 依据 |
|---|---|---|
| P1 #2：生成内容表在 **641–900px** 区间违反卡片化契约，横向溢出 156px | 阈值**不是视口断点而是容器查询** `@container (max-width: 48rem)`：容器 <768px 时卡片化，对应视口约 1112px。修复后**全部 12 档视口（390–1200px）横向溢出均为 0** | 脚本逐档实测：1150px 容器 806px 仍是表头 + `table-row`；1100px 容器 756px 已 `thead{display:none}` + `tr{display:grid}`；溢出列全 0 |
| P1 #2 次生问题：「sticky 操作列错位」属观感问题 | 实为**数据丢失**：800px 视口下「内容预览」整列被操作列完全覆盖 | 元素截图（`genstruct-800.png`） |
| P2：面板标题图标色散落在 **13 处**内联 | 实为 **28 处**（`AiParamsPanel` 6、`AiConfigPanel` 5、`SiteOperationsTab` 14、`ProxyView` 2、其余 1 处） | 全仓统计 `className="size-N text-primary"` |
| P3 #154：触控目标低于 44px | 44px 是 WCAG **2.5.5（AAA）** 门槛；AA 对应 **2.5.8（24×24）**。逐项实测后，按钮 40px、tabs 32px、下拉 32–36px 均已达标；真正不达 AA 的只有内容预览表的 Checkbox（16×16）与链接（16–18.8px），共 28 处 | 390px 视口 `elementFromPoint` 真实命中测试 |
| P3 #163：需抽 `ui/textarea.tsx` | 该组件**已存在**且已被 7 个文件使用；真正问题是 AI 面板 4 处绕过它手写 | 全仓检索 + 实际渲染实测 |

**报告未发现、修复时新查出的问题（2 项）**

1. `.admin-panel-status` 声明的 `min-width: 4.75rem` 从未生效 —— 被同文件第 7083 行同特异性的 `.admin-panel-heading__actions > *` 按源码顺序覆盖，计算值为 `0px`。全站 9 个胶囊宽度 57.2–82px（极差 24.8px），8 个低于声明的下限。
2. `AiWritingPanel` 有 16 个控件缺少可访问名称（`<Label>` 只作视觉标题、未配 `htmlFor`；`CustomSelect` 渲染 `button[role=combobox]` 且接口不支持 `id`）。

**修复落地（15 个提交，全部含实测证据）**：P0 工具栏巨型方框 `751d74c` → 生成表容器查询 `5405152` → 审计表键盘可达 `305cf79` → reduced-motion 守卫 `4f46e7d` → 死类清理 `06dc163` → 分页标签 `829bc4a` → caption 去冗余 `a72817c` → 图表常量收口 `ec2bead` → 筛选宽度自适应 `f44612d` → 图标色单条规则 `5604fe0` → 状态胶囊最小宽度 `6e49a2c` → 创作面板标签 `9260dbb` → textarea 共用组件 `6f56aa5` → 触控目标达 AA `6bada8d` → 空态分级 `db98702`。审计报告本身在 `6844677` 提交。

**仍未处理**：AI 规则分散在 5 个 `@media` 块间这一结构性问题（本报告最昂贵的发现），以及窗口缩至 900px 以下时全站工具栏由横排转竖排的密度损失 —— 两项都需要设计决策，不是单点修复。

### 后续修订（2026-09-19）：本报告的容器查询结论已被推翻

报告把「改用 `@container (max-width: 48rem)` 按容器宽度卡片化」记为对 P1 #2 的**进一步改进**（`5405152`）。后续工作证明**这是治标**：真正的根因是该表自带 `min-w-[760px]`，容器查询只是在为这个多余的最小宽度打补丁。

**现状**：已生成内容表与 AI 任务面板均已收敛到标准契约 —— `AdminDataPanel` + `columns`（百分比列宽合计 100%）+ shadcn `Table` + `data-*` 标注。`fixed` 布局不再需要最小宽度，901–1100px 破版带从根上消失；`@container` 块、`sticky` 冻结列、自定义行列表规则全部删除。**全站数据表统一走 900/901 视口断点，无例外**。

**本次调研另新查出范本自身的既有缺陷（本报告未发现）**：小说管理表在 **901px 下操作列真实裁切** —— 3 个 32px 图标按钮需 112px，操作列可用仅 50px，`td` 的 `overflow: hidden` 使第 3 个按钮 `elementFromPoint` 命中 `td` 而非自身（不可点击）。根因是范本用 11% 百分比给图标按钮，而 901px 时后台扣掉侧栏后表宽仅 557px。该缺陷未修（不在本次范围），但已写入 `DESIGN.md` 的 Action Column Sizing 条目：**文字按钮面板按实测内容给操作列（21%），不要复制范本的图标按钮百分比**。

**教训**：报告当时把「让阈值跟随容器」当作终局解法，是因为没有追问「这张表为什么需要 760px」。遇到固定最小宽度，先查它的来源能否消除，再考虑调整断点变量。

---

## Audit Health Score

| # | 维度 | 分数 | 关键发现 |
|---|------|------|----------|
| 1 | Accessibility | 1 | 审计表 50 行可点击但 `tabIndex=-1`、无 `role`/键盘处理；无限动画无 reduced-motion 守卫 |
| 2 | Performance | 3 | 无布局抖动、无阻塞资源；图表为纯 SVG 无动画开销 |
| 3 | Responsive Design | 1 | ≤900px 工具栏 Select 被撑成 192px 巨型方框；生成内容表窄屏违反卡片化契约（阈值经复核为容器查询而非视口断点） |
| 4 | Theming | 3 | token 体系完整、双主题实测正确；图表字面值与图标色散落构成轻度漂移 |
| 5 | Implementation Integrity | 2 | 5 个死类（1 处真实视觉损坏）；两处注释与实现/规范脱节 |
| **Total** | | **10/20** | **Acceptable（需实质工作）** |

分数说明：Implementation Integrity 的扣分集中在**命名收口**与**注释准确性**，而非架构失当 —— 两张表脱离 `AdminDataPanel` 是有注释记录的可辩护权衡。Responsive 的 1 分由 P0 独立决定（一个面板组的主要筛选器在平板/手机上不可用，单此一项即无法高于 1）。

---

## 实现完整性判定

**通过，但带条件。**

这套面板确实表达了一个产品专属的系统，不是通用模板的产物：`--admin-panel` / `--admin-border` 派生的纸面色表面、`AdminDataPanel` + `AdminPanelHeading` 的统一语言、紧凑档字阶、奶茶暖调的地面与发丝描边，八个面板共享同一套叙事。impeccable detector 对 `web/src/pages/admin/ai` + `AiTab.tsx` 静态扫描返回 **0 发现**，可见 token 使用纪律在源码层面被认真遵守。双主题实测（light/dark 各 32 张截图）无一处颜色错乱，这是 Theming 拿到 3 分的基础。

**但它没有完全兑现自己的契约。** 最清晰的一处是命名层面的收口遗漏：`AiTasksPanel.tsx:140` 用了全站唯一的 `ai-list-status`，而其余 9 个消费位置（共 10 次使用）一律 `admin-panel-status`，导致该面板的计数胶囊退化为裸文本。

同样值得指出的是它**做得对的地方**——两张数据表（`.ai-audit-table` / `.ai-generations-table`）都主动绕开了 `AdminDataPanel` 的 grid 卡片化，并且**在 TSX 与 CSS 两处**都写了注释说明理由（`AiAuditPanel.tsx:124-126`、`AiGenerationsPanel.tsx:353-354`、`admin-operations.css:2034-2037`）：跨列展开详情行与 sticky 冻结操作列在卡片化下会错配。这是**有记录的、可辩护的权衡**，不是纪律松弛 —— 而且 `AiTasksPanel.tsx:135` 确实正常接入了 `AdminDataPanel`。真正的完整性缺口不在于"有没有绕开契约"，而在于**支撑这些权衡的注释本身已经与实现不符**（L2037 把 640px 的规则写成了 900px），以及 4 个废弃类名仍在 TSX 里充当看似有效的语义锚点，会诱导下一个维护者去 CSS 里寻找永不存在的规则。

---

## 执行摘要

- **Audit Health Score：10/20（Acceptable）** —— 截至本次复核，报告的 13 项发现已全部落地，另新查出并修复 2 项报告未发现的问题（见修订记录）
- **问题总数：13**（P0 × 1，P1 × 4，P2 × 5，P3 × 3），其中 5 项的措辞或计数经实测修正
- **Top 5 关键问题**
  1. **[P0] ≤900px 工具栏 Select 被撑成 192px 巨型方框** —— 8 个面板中 3 个（AI 任务 / 已生成内容 / 调用审计）的主筛选器在平板与手机上完全不可用，工具栏高度从 58px 膨胀到 246px。根因是一行 row 方向的 `flex: 1 1 12rem` 落在 `flex-direction: column` 容器里。**已修复（`751d74c`，实测 246 → 86px）**
  2. **[P1] 生成内容表在窄屏既未卡片化、又强制 760px 宽** —— 原标题写的「641–900px」区间有误：实测阈值是容器查询，且 800px 下「内容预览」列被操作列完全覆盖（数据丢失，非观感问题）。**已修复（`5405152`，12 档视口溢出全为 0）**
  3. **[P1] 调用审计表 50 行键盘不可达** —— 展开详情（IP / UA / Token 明细）是唯一入口且仅响应鼠标。**已修复（`305cf79`，50 行改为真实 button，焦点环 2px）**
  4. **[P1] `ai-list-status` 使任务面板计数胶囊退化** —— 全站 10 次同类使用中唯一的裸文本。**已修复（`06dc163`）**
  5. **[P1] `ai-task-sweep` 无限动画无 reduced-motion 守卫** —— 该文件 8 个 reduce 块中，有一个已经处理了同一个 `.ai-service` 选择器，却遗漏了本条。**已修复（`4f46e7d`，实测 `::after` 为 `display:none`）**
- **建议下一步**：P0/P1 均已收口。剩余的是**结构性**工作 —— AI 规则分散在 5 个 `@media` 块间（本报告最昂贵的发现，未处理）与 900px 以下工具栏转竖排造成的密度损失，两者都需设计决策。

---

## 详细发现（按严重度）

### [P0] ≤900px 工具栏 Select 被撑成 192px 巨型方框

- **位置**：`web/src/styles/admin-operations.css:480-484`（`.ai-service :is(.ai-tasks-toolbar, .ai-audit-toolbar, .ai-generations-toolbar) [data-slot='select-trigger']` 的 `flex: 1 1 12rem`，位于 `@media (max-width: 900px)` 块，span 469–489）与 `web/src/styles/admin-operations.css:7760-7763`（`.admin-toolbar--inline { flex-direction: column; align-items: stretch }`，位于 `@media (max-width: 900px)` 块，span 7564–7778）
- **类别**：Responsive
- **实测证据**：`tasks` / `content` / `audit` 三个面板在 900px 与 390px 视口下：`.admin-toolbar` 高度 **246px**，`[data-slot='select-trigger']` 计算尺寸 **562×192px**（900px）/ **324×192px**（390px），`flex: 1 1 192px`，父容器 `display:flex; align-items:stretch`。对照 1600px 视口，同一控件是正常的 **120×32px** / **140×32px**。截图 `tasks__light__mobile-390.png`、`audit__light__tablet-900.png` 确认视觉形态为空白圆角大方框，数值垂直居中、chevron 远在右端。
- **根因**：`.admin-toolbar--inline` 在 900px 以下把主轴改为 `column`（L7761）。同一断点下 `flex: 1 1 12rem`（L483）是**行方向语义的简写**：在 column 容器中 `flex-basis: 12rem` 作用于**高度轴**（12rem = 192px，与实测 192px 完全吻合），`flex-grow: 1` 再让 Select 吃掉工具栏剩余高度，`align-items: stretch` 补上 `width: 100%`。
- **影响**：平板与手机上，AI 任务 / 已生成内容 / 调用审计的首要筛选器占据近半屏高度且值为肉眼难辨；这三个面板的顶部工具栏因此从 58px 撑到 246px，把首屏内容全部推离视口。
- **标准**：WCAG 2.1 AA 1.4.10 Reflow
- **建议**：在 column 主轴下把 basis 归零 —— 例如在 900px 块内追加 `flex: 0 0 auto`（或显式 `flex: none; height: var(--admin-control-height)`），让 `align-items: stretch` 单独负责交叉轴宽度。`12rem` 基数的原始意图是"搜索框整宽"，应对 `[data-slot='input']` 生效，而非 `select-trigger`。
- **建议命令**：`/impeccable adapt`

### [P1] 生成内容表在 641–900px 区间违反卡片化契约

> **【已修订】** 标题中的「641–900px」有误，实际阈值是容器查询而非视口断点；且「sticky 列错位」低估了后果（800px 下内容预览列被完全覆盖，属数据丢失）。详见上方修订记录。此发现已由 `5405152` 修复，修复后 12 档视口溢出全为 0。

- **位置**：`web/src/pages/admin/ai/AiGenerationsPanel.tsx:356`（`<table className="w-full min-w-[760px] text-sm">`）与 `web/src/styles/admin-operations.css:4847-4850`（`.ai-generations-table table { display:block; min-width:0 }`）
- **类别**：Responsive
- **实测证据**：900px 视口下表格实体宽 **760px**、右溢出 **156px**，且 `thead.border-b.bg-muted/50` 仍参与布局（宽 760px）——**证明卡片化未生效**。390px 视口下溢出 **0**，`thead` 已隐藏——**证明卡片化在 640px 才生效**。脚本确认 L4847 所属块是 `@media (max-width: 640px)`（span **4813–5307**），而非 900px。
- **契约偏差**：DESIGN.md:290 明文规定「**900px 及以下是卡片化**：thead 隐藏，`tr`/`td` 转 grid，`data-label` 变伪元素」。当前实现把边界推迟到了 640px，于是 **641–900px 这整段区间既没有卡片化、又保留 `min-w-[760px]`**，成为纯粹的破版带。
- **次生问题**：`admin-operations.css:2037` 的注释写着「已生成内容表沿用其既有的移动端卡片系统（见下方 .ai-generations-table 的 **900px** 规则）」——该注释描述的断点与实现（640px）不符，会持续误导后续维护者。
- **影响**：平板竖屏与小平板横屏（业界最主流的 768–900px 区间）打开「已生成内容」，表格横向滚动，每行内容与右侧 `sticky` 操作列需要双向滚动才能对齐操作，勾选框与操作按钮分处两端。
- **标准**：WCAG 2.1 AA 1.4.10 Reflow
- **建议**：把 L4813 块内 `.ai-generations-table` 的整套卡片化规则（L4847–L4985）外提到 900px 块，与 DESIGN.md 契约对齐；或明确接受 640px 边界，则须撤掉 `min-w-[760px]` 并同步修正 L2037 注释。**二选一，不留中间态**。注意该表同时使用原生 `<table>` 结构（`AiGenerationsPanel.tsx:357` 有 `<caption>`），若改走 `AdminDataPanel` + `columns` 契约，还需保证 `data-label` 完整。若把规则外提到 900px，务必同时验证跨列子行（`.ai-generation-row--child`）与 `sticky` 操作列在 641–900px 下不错位 —— 这正是 `AiGenerationsPanel.tsx:353-354` 注释担心的风险，外提时必须实测确认。
- **建议命令**：`/impeccable adapt`

### [P1] 调用审计表行键盘不可达

- **位置**：`web/src/pages/admin/ai/AiAuditPanel.tsx:145-149`
- **类别**：Accessibility
- **实测证据**：`.ai-audit-row` 计算样式 `tag=TR`、`tabIndex=-1`、`role=null`、无 `onkeydown`、`cursor:pointer`、`aria-expanded="false"`。`.ai-list-body` 内可聚焦元素总数 **4**，而行数 **50**。展开详情行（`AiAuditPanel.tsx:203` 的 `.ai-audit-detail`，含调用 ID / 模型 / IP / UA / Token 明细）是 `<tr>` 内的普通内容，没有第二条入口。
- **影响**：键盘与读屏用户完全无法访问 50 行记录的任何详情数据。`aria-expanded` 被挂在不可聚焦且无 role 的 `<tr>` 上，读屏不会播报为可展开控件，反而制造「有展开态却无法操作」的矛盾语义，比完全不加 ARIA 更具误导性。
- **标准**：WCAG 2.1 AA 2.1.1 Keyboard、4.1.2 Name/Role/Value
- **建议**：把展开入口做成一枚真实 `<button>`（置于首列，携带 `aria-expanded` + `aria-controls` 指向详情行 `id`），`<tr>` 保留点击委托作为鼠标便利路径；或给 `<tr>` 加 `tabIndex={0}` + `role="button"` + `Enter`/`Space` 处理。前者更稳，也顺带解决「整行可点但无可见焦点环」的问题。
- **建议命令**：`/impeccable harden`

### [P1] `ai-list-status` 使任务面板计数胶囊退化（全站唯一异类）

- **位置**：`web/src/pages/admin/ai/AiTasksPanel.tsx:140`
- **类别**：Implementation Integrity
- **实测证据**：`web/src/styles/*.css` 全文检索 `ai-list-status` 仅 1 处命中，正落在 `AiTasksPanel.tsx:140` 自身，**CSS 零命中**。同位置的既定约定是 `.admin-panel-status`（`admin-operations.css:69`，`.is-error` 变体在 L85），全站 `web/src` 下共 **10 次使用、9 个消费位置**：`AiAuditPanel.tsx:109`、`AiGenerationsPanel.tsx:338`、`JobsTab.tsx:451, 543`、`ModerationTab.tsx:656`、`SettingsTab.tsx:540, 665, 750, 818`、`MobileTelemetryTab.tsx:194`。`AiTasksPanel` 是唯一例外。
- **影响**：截图对比直接可见 —— `AiTasksPanel` 的「显示 100 条」渲染为无描边、无底色的裸文本，而 `AiAuditPanel` 同位置的「显示 50 条」是带描边与浅底的胶囊。用户无法在两个相邻面板间建立「这是计数状态」的一致心智；且该处 `error` 态也因此失去着色能力。
- **标准**：一致性缺陷（非 WCAG）
- **建议**：改为 `<span className={`admin-panel-status${error ? ' is-error' : ''}`}>`，与其余 8 处对齐，同步免费获得错误态着色。
- **建议命令**：`/impeccable polish`

### [P1] 无限进度动画无视 prefers-reduced-motion

- **位置**：`web/src/styles/admin-operations.css:2963-2985`（`.ai-task-progress::after { animation: ai-task-sweep 1.4s var(--ease) infinite }`，顶层规则，不在任何媒体查询内；消费方为 `AiCoverPanel.tsx:635`）
- **类别**：Accessibility / Performance
- **实测证据**：全文检索 `ai-task-sweep` 仅 2 处命中（L2976 定义、L2978 `@keyframes`），**无任何 `@media (prefers-reduced-motion: reduce)` 守卫**。该文件共 **8** 个 reduce 块（分布于 L491、1516、2691、5500、5721、6025、6252、7285），其中 **L491 块处理的正是同一个 `.ai-service :is(.ai-tasks-toolbar, .ai-audit-toolbar, .ai-generations-toolbar)` 选择器**（该块仅设 `transition: none`），却漏掉了这一条。以 `reducedMotion: 'reduce'` 启动的 Chromium 实测确认动画仍为 `infinite`。
- **影响**：封面/创作任务进行中，前庭功能敏感用户会持续看到横穿的流动光带；这是整个 AI 表面唯一的无限循环动画（也是全页唯一 1.4s 周期的循环）。
- **标准**：WCAG 2.1 AA 2.3.3 Animation from Interactions；DESIGN.md 要求动画尊重该偏好
- **建议**：在 L491 块内补 `.ai-task-progress::after { animation: none }`，同时保留静态的进行中指示 —— `.ai-task-progress` 本身已有 `background: var(--accent-light)`（L2967），只需让 `::after` 停留在 `translateX(0)` 呈现一条实心 `var(--accent)` 色条即可，状态可辨识性不丢。
- **建议命令**：`/impeccable animate`

### [P2] 图表主题字面值硬编码且四处重复

- **位置**：`web/src/pages/admin/ai/AiUsagePanel.tsx:131, 138, 146`（`tick={{ fontSize: 12, fill: 'var(--text-muted)' }}`）、`:156-158` 与 `:240-242`（`borderRadius: '8px'` / `fontSize: '12px'`）、`:167` 与 `:247`（`wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}`）
- **类别**：Theming
- **实测证据**：上述 `fontSize` / `borderRadius` / `paddingTop` 均为字面值。两处 `Tooltip` 的 `contentStyle` 与两处 `Legend` 的 `wrapperStyle` **逐字重复**（`:156` 对 `:240`，`:167` 对 `:247`），共 11 处内联样式点。颜色侧正确使用了 `var(--text-muted)` / `var(--bg-card)` / `var(--border)`，故双主题实测无错色。
- **影响**：主题的字阶或圆角策略调整时，图表不会跟随，产生持续的视觉漂移；重复的配置对象意味着任何调整需改 4 处。危害程度中低（当前视觉正确），但属于典型的「正确但脆弱」。
- **建议**：在 `web/src/pages/admin/ai/shared.tsx` 内导出单一常量对象（如 `usageAxisProps`、`usageTooltipStyle`、`usageLegendStyle`），四处共用；字号改引语义档位而非字面值。
- **建议命令**：`/impeccable polish`

### [P2] 分页跳转输入框无可访问名称

- **位置**：`web/src/components/admin/Pagination.tsx:36-54`（由 `AiAuditPanel.tsx:269` 与 `AiGenerationsPanel.tsx:550` 消费）
- **类别**：Accessibility
- **实测证据**：探针在 `audit` 与 `content` 面板各检出 **1** 个无名称输入框，精确定位为 `INPUT[type=number]`、`data-slot="input"`、`id=""`、`placeholder=""`、无 `aria-label`/`aria-labelledby`。其视觉说明来自兄弟文本节点「跳转 …… 页」（`Pagination.tsx:35, 55`），该文本不在任何 `<label>` 内，无法与输入框建立程序化关联。
- **影响**：读屏用户聚焦该框时只听到「数字 输入框」，不知其用途。这是**共享组件**的缺口，会外溢到所有使用分页的后台页（JobsTab / ModerationTab / SettingsTab 等），一处修复全站受益。
- **标准**：WCAG 2.1 AA 3.3.2 Labels or Instructions、4.1.2 Name/Role/Value
- **建议**：给该 `Input` 加 `aria-label="跳转到指定页"`，或补 `<label className="sr-only" htmlFor>` + 唯一 `id`。修复应落在 `Pagination.tsx`，而非在 AI 面板内绕过。
- **建议命令**：`/impeccable clarify`

### [P2] 筛选下拉宽度硬编码，长标签静默截断

- **位置**：`web/src/pages/admin/ai/AiAuditPanel.tsx:87`（`w-[140px]`）、`AiTasksPanel.tsx:124`（`w-[120px]`）、`AiGenerationsPanel.tsx:538`（`w-[88px]`）
- **类别**：Responsive
- **实测证据**：三处固定 px 宽度在 1600px 与 390px 视口下完全一致（120 / 140 / 88px），不随容器或内容变化。`SelectTrigger` 基类自带 `whitespace-nowrap` 与 `*:data-[slot=select-value]:line-clamp-1`（`web/src/components/ui/select.tsx:40`），即超长值会被静默裁剪而非提示。
- **影响**：`AiAuditPanel` 的类型选项含「封面描述词」等 5 字标签，在 140px 内已接近临界；用户字体放大或语种切换后会出现无提示截断，用户无法确认当前筛选值。
- **建议**：改用 `min-w-*` 下限 + 内容自适应（`w-fit` + `min-w`），或引入与 `--admin-control-height` 同源的宽度档位 token。
- **建议命令**：`/impeccable adapt`

### [P2] 面板标题图标色散落在 13 处内联

> **【已修订】** 计数有误：全仓实为 **28 处**，非 13 处（遗漏了 `SiteOperationsTab` 14 处与 `ProxyView` 2 处）。已由 `5604fe0` 修复，颜色下沉为 `.admin-panel-title > svg` 单条规则。

- **位置**：`AiParamsPanel.tsx:47, 97, 173, 221, 247, 283`（6 处）、`AiConfigPanel.tsx:174, 181, 242, 301, 354`（5 处）、`AiWritingPanel.tsx:513`、`AiCoverPanel.tsx`（1 处），形如 `<SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />`
- **类别**：Theming
- **实测证据**：脚本统计 `className="size-N text-primary"` 模式共 **13** 处（AiConfigPanel 5、AiParamsPanel 6、AiWritingPanel 1、AiCoverPanel 1）。共享类 `.admin-panel-title`（`admin-operations.css:86-90`）只提供 `inline-flex` + `gap`，**不负责颜色**，因此颜色策略分散在各调用点。
- **影响**：当前符合 10% Accent Rule（图标确为点缀，未被滥用）。但若产品决定面板图标改用 `--text-muted` 或按状态着色，需改 28 处，容易出现漏改导致面板间图标色不一致。
- **建议**：把颜色提升为 `.admin-panel-title > svg`（或 `[data-slot='svg']`）单条规则，TSX 只保留 `size-*` 与 `aria-hidden`。
- **建议命令**：`/impeccable polish`

### [P2] 表格 caption 复述表头，读屏噪音

- **位置**：`AiAuditPanel.tsx:129`、`AiGenerationsPanel.tsx:357`
- **类别**：Accessibility
- **实测证据**：两处 `<caption className="sr-only">` 逐字列举列名 —— 「AI 调用记录列表，含用户、类型、关联内容、消耗、成本与时间，行可展开详情」/「已生成内容列表，含类型、关联内容、内容预览、模型与生成时间，批次可展开章节」。而 `<th scope="col">` 已完整提供同样的列名（`AiGenerationsPanel.tsx:360-374`）。
- **影响**：读屏用户会先听完一长串列名，随后再听一遍表头，属纯冗余；正面之处是确实为表格提供了可访问名称，故非缺陷而是可用性折损（可访问名称应当简短）。
- **建议**：caption 只保留表格标识与交互提示（如「AI 调用记录，行可展开查看详情」），列名交给 `th scope="col"`。
- **建议命令**：`/impeccable clarify`

### [P3] 触控目标低于 44px

> **【已修订】** 44px 是 WCAG 2.5.5（AAA）门槛，AA 对应 2.5.8（24×24）。逐项实测后本报告列举的 tabs 32px / switch 32×18px / select 36px **均已达标 AA**（switch 另有外层 label 包裹，有效目标 326×20）；真正不达 AA 的是报告未列出的内容预览表 Checkbox（16×16）与链接（16–18.8px），共 28 处，已由 `6bada8d` 修复。

- **位置**：`AiWritingPanel.tsx:517-519`（`TabsTrigger` 54×**32**）、`AiParamsPanel.tsx:106` 的 `<Switch>` 与 `AiConfigPanel.tsx:310`、`AiCoverPanel.tsx:500` 同款（**32×18**）、`AiParamsPanel.tsx:225-227` 三个 `SelectTrigger`（各 **36** 高）
- **类别**：Responsive
- **实测证据**：三档视口一致检出：`[data-slot='tabs-trigger']` 54×32px，`[data-slot='switch']` 32×18px，`size="default"` 的 `select-trigger` 高 36px。按钮主体普遍 40px 高。
- **影响**：符合 DESIGN.md 的紧凑档取向，桌面鼠标场景无碍；390px 触屏上开关与分段 tab 偏小，误触率上升。此为本审计中优先级最低项，因为它与设计系统的紧凑取向直接冲突，改动需权衡。
- **建议**：仅在小屏断点扩展**命中区**（透明 `::after` 或 `min-height`）至 44px，视觉尺寸保持不变，不破坏紧凑档字阶。
- **建议命令**：`/impeccable adapt`

### [P3] `AiParamsPanel` 手写 textarea 与后台控件层分叉

> **【已修订】** 建议中的 `web/src/components/ui/textarea.tsx` **已存在**且已被 7 个文件使用，无需新抽。真正的问题是 4 处绕过该组件手写，已由 `6f56aa5` 修复；`AiCoverPanel` 那处按设计使用了不同 token（`--border` / `--bg-card` + `resize-y`），刻意保留并在原处加注说明。

- **位置**：`AiParamsPanel.tsx:82-88`、`AiParamsPanel.tsx:213`
- **类别**：Implementation Integrity
- **实测证据**：两处 `<textarea data-slot="textarea">` 手写完整长串工具类（`min-h-[100px] w-full border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 ...`），而同面板的 `Input` 走 shadcn 组件。后台控件样式本应由 `.admin-layout [data-slot='textarea']`（`admin-operations.css:4757-4761`，提供 `--admin-panel` 底 + `--admin-border-strong` 描边）统一，但内联的 `border-input` / `bg-background` 又覆盖了一遍。
- **影响**：同一表单内 textarea 与 Input 的描边色/底色来源不同（一层走 `.admin-layout` token 规则，一层走 Tailwind `border-input`）。当前视觉一致，但两套维护路径并行，任一侧调整都会使二者分叉。
- **建议**：抽 `web/src/components/ui/textarea.tsx`（带 `data-slot="textarea"`），复用既有 `.admin-layout [data-slot='textarea']` 规则。
- **建议命令**：`/impeccable harden`

### [P3] 空状态缺少引导与层级

- **位置**：`AiUsagePanel.tsx:115`、`AiUsagePanel.tsx:204`、`AiAuditPanel.tsx:120`、`AiTasksPanel.tsx:146`
- **类别**：Implementation Integrity
- **实测证据**：`AdminEmptyState` 统一渲染单行文本（「所选范围内没有 AI 调用记录」/「暂无 AI 任务」），无图标、无下一步动作、无与错误态的视觉区分。
- **影响**：全新实例首次进入「用量统计」时是空白体验，用户不知道是"配置未完成"还是"确实无数据"。当前实例数据充足，故优先级最低；但对新部署是真实的体验断点。
- **建议**：区分「无数据」与「未配置」两种空态，后者给出指向 `?sub=config` 的动作。
- **建议命令**：`/impeccable onboard`

---

## 系统性模式

- **AI 规则在 5 个不同 @media 块间分散**：`admin-operations.css` 共 49 个媒体块，AI 面板的响应式规则散落在 L469（工具栏 stretch + select flex）、L2146（列表内边距）、L3292（分页）、L4813（生成表卡片化）、L7564（工具栏转列）五处。P0 的根因正是 L469 与 L7564 两个块对**同一组元素**施加了互相冲突的轴假设，而它们相距 7000 行。这是本表面最昂贵的结构性问题。
- **契约执行的不对称**：detector 0 发现、Theming 3/4，说明 token 使用纪律良好；但**依赖人工记忆**的契约最脆弱 —— DESIGN.md:280 明言「少写一个 `data-label`，那张卡片在 900px 以下就会缺一个字段标签」。两张 AI 表选择绕开该契约本身有充分理由且已注释记录，问题在于绕开之后的**替代方案没有与规范对齐**（640px vs 900px），而 4 个废弃类名仍在 TSX 中充当看似有效的语义锚点。契约中可被静态检查的部分被遵守，需人记住的部分被遗忘。
- **注释与实现脱节（两处）**：`admin-operations.css:2037` 声称生成表的卡片化规则在「900px」，实为 640px 块（span 4813–5307，规则 L4847–L4985）；`AiGenerationsPanel.tsx:353-354` 声称「不套用卡片化，否则跨列子行与 sticky 列在窄屏会错位」，而 CSS 中确实存在该表的完整卡片化规则（640px 生效）。两处注释描述的是**意图**，实现走了另一条路且无人同步 —— 这类脱节会让下一个维护者按错误前提修改代码，比没有注释更危险。
- **正面实践（应当保持）**：`AsyncStates` 三态（LoadingState / ErrorState / InlineError）在 6 个面板一致落地；`AdminMetricStrip` 通过内联 `--admin-metric-columns` 跟随项数而非 CSS 覆盖（`admin-operations.css:464-467` 记录了这次修正）；`aria-live="polite"` 在三个工具栏正确用于状态播报；`aria-hidden="true"` 在全部装饰性图标上一致使用；两张表均提供 `<caption>`；`AiTasksPanel.tsx:135` 正常接入 `AdminDataPanel`；窗口缩至 400px 以下按钮正确转全宽。这些说明团队已在处理状态一致性与可访问性，只是尚未覆盖键盘路径、无限动画与断点归属。

---

## 推荐动作（按优先级）

> **状态（2026-09-17 复核）**：下列 1–9 项均已落地，提交号见修订记录。第 10 项的全量复检已执行（`tsc` 0 错误、68 项测试通过、生产构建通过、eslint 无新增警告）。

1. **[P0] `/impeccable adapt`** —— 修 ≤900px 工具栏 Select 巨型方框：`admin-operations.css:480-484` 的 `flex: 1 1 12rem` 在 L7761 的 column 主轴下使 12rem 成为高度基（12rem = 实测 192px）。改为 column 安全的写法。**已修复 `751d74c`**
2. **[P1] `/impeccable adapt`** —— 生成内容表：把卡片化规则提到 900px 块以对齐 DESIGN.md:290，或撤掉 `min-w-[760px]` 并修正 L2037 注释。**实际采用了后者并进一步改进：改为容器查询 `@container (max-width: 48rem)`，让阈值跟随容器而非视口，`5405152`**
3. **[P1] `/impeccable harden`** —— 给 `.ai-audit-row`（`AiAuditPanel.tsx:145`）真实键盘入口；同时抽 `ui/textarea.tsx` 收口 `AiParamsPanel` 手写样式。**前者 `305cf79`；后者该组件已存在，实际只需让 AI 面板改用，`6f56aa5`**
4. **[P1] `/impeccable polish`** —— 清死类：`ai-list-status` → `admin-panel-status`；删除四个废弃钩子。**已修复 `06dc163`**
5. **[P1] `/impeccable animate`** —— 在 `admin-operations.css:491` 块补 `.ai-task-progress::after` 的 reduce 处理。**已修复 `4f46e7d`（用 `display: none` 而非 `animation: none`，避免静态色条叠加）**
6. **[P2] `/impeccable polish`** —— 图表轴/提示/图例样式抽常量；面板图标色提升为单条规则。**已修复 `ec2bead` + `5604fe0`**
7. **[P2] `/impeccable clarify`** —— `Pagination.tsx:36` 加 `aria-label`；两处 `<caption>` 去列名复述。**已修复 `829bc4a` + `a72817c`（Home.tsx 同名输入框一并处理）**
8. **[P2] `/impeccable adapt`** —— 筛选下拉宽度改自适应，消除静默截断。**已修复 `f44612d`（实测 120/140/140/88px，`min-width` 已生效）**
9. **[P3] `/impeccable onboard`** —— 空状态区分「无数据」与「未配置」。**已修复 `db98702`**
10. **[最后] `/impeccable polish`** —— 全量收口复检，重跑 `/impeccable audit` 对比分数。**已执行复检**

---

## 功能缺口（样式收口后追加，2026-09-17）

样式项全部落地后重新审视「界面是否完整承载了后端能力」，发现的问题与视觉无关：**三个后端已完整实现、且已有 API 测试的能力，前端调用数为 0**。根因是提交 `ee06c2d`（feat(ai): 落实第二批续写与封面增强，2026-09-10）只改了 `api/`，没有配套前端。把 `api/src/routes/ai.ts` 的 53 条路由与 `web/src/lib/api.ts` 逐一对照后确认：

1. **选段改写**（`POST /writing/rewrite` + `POST /writing/rewrite/:id/apply`，AC 测试 `ai.test.ts:996`）—— 完全无入口。已生成内容的草稿只能整段重写或手工编辑，无法「选中一段让 AI 只改这一段」。
2. **封面历史与恢复**（`GET /cover/history/:novelId`、`/history/:id/image`、`POST /history/:id/restore`，AC 测试 `ai.test.ts:2441`）—— 完全无入口。封面被误替换后无法回滚，尽管后端已保留最近 10 张快照。
3. **人工画像校正**（`PUT`/`DELETE /writing/profiles/:kind/:novelId/override`，AC 测试 `ai.test.ts:1065`）—— 完全无入口。更隐蔽的是，三个画像 GET 早已返回 `manualOverride` / `effectiveContent` / `effectiveOrigin` / `exclusionReason` / `baseProfileRevision`，而 `web/src/lib/api.ts` 把这些字段的**类型声明**写成 `{ profile: string }` —— 数据一直在传，只是被前端丢弃。

三项均已接入，提交 `d3d36a1`（选段改写）、`0966097`（封面历史）、`728bebf`（人工校正）。

### 由此暴露的两个非视觉缺陷

- **乐观并发形同虚设**：`adoptCoverCandidate` 与 `uploadCover` 从不发送 `expectedCoverVersion`，后端 `coverVersion()` 校验因此永远收不到值、永不触发（`covers.ts` 的两处 409 成为死代码）。接入封面历史时一并修好。这类「后端有校验、前端不传值」的缺口不会被类型检查或测试发现 —— 两边各自的测试都是绿的。
- **契约靠人记忆**：`manualOverride` 与 `effectiveContent` 一直被返回却从未被声明，说明类型层没有跟随 API 演进。建议后续在 `api/src/routes/ai.ts` 的响应对象上导出类型供前端引用，而非各写一份。

### 验证方式

三项均做了真实后端契约验证，不依赖 mock：改写缺陷由实机 E2E 发现（70 字选段返回 2069 字建议，起因是 prompt 把选段后的 2000 字上下文直接接在选段之后，诱导模型续写），修复后同一选段返回 75 字；封面历史造出两张可区分散图，确认走鉴权 Blob（非鉴权直连返回 401）；人工校正覆盖 7 项契约（错误基准 409、过期修订号 409、生效切换、重新提取后自动停用而非删除、幂等重放、删除复原）。所有探针数据已复原，`novel_cover_history` 与 `novel_ai_profile_overrides` 均回到 0 行。

---

## 复现资产

- 截图：`.tmp/shots-ai/{sub}__{theme}__{viewport}.png` —— 8 面板 × 2 主题 × 4 视口（desktop-1600 / laptop-1280 / tablet-900 / mobile-390），共 64 张
- 度量数据：`.tmp/shots-ai/measure.json`（溢出 / 触控尺寸 / 异常盒模型 / 三档视口工具栏实测）、`.tmp/shots-ai/a11y.json`、`a11y2.json`、`a11y3.json`（对比度 / 键盘可达性 / 可访问名称 / reduced-motion 实况）
- 探针脚本：`.tmp/ai-audit-shots.mjs`、`.tmp/ai-audit-measure.mjs`、`.tmp/ai-audit-a11y.mjs`、`.tmp/ai-audit-a11y2.mjs`、`.tmp/ai-audit-a11y3.mjs`、`.tmp/linecheck.mjs`、`.tmp/bracecheck.mjs`、`.tmp/auditcheck.mjs`、`.tmp/verify2.mjs`、`.tmp/verify3.mjs`、`.tmp/finalcheck.mjs`、`.tmp/final2.mjs`、`.tmp/tsxcheck.mjs`

**基线**：`npx tsc --noEmit` 零错误；`npx eslint web/src/pages/admin/ai web/src/pages/admin/AiTab.tsx` = **15 warnings / 0 errors**（全部为 `react-hooks/set-state-in-effect` 与 `react-refresh/only-export-components`，属状态管理与 HMR 约定，与本次样式审计无直接关系）；impeccable detector 对 `web/src/pages/admin/ai` + `AiTab.tsx` + `admin-operations.css` 返回 **0 发现** —— 正则引擎对 TSX 无信号，故本次以运行时 DOM 探针为主要证据来源。

**未执行的检查**（诚实披露）：未做 Lighthouse / Core Web Vitals 实测（本表面为鉴权后台，LCP 受 API 延迟主导，参考价值低）；未做真实读屏软件（NVDA/JAWS）验证，可访问性结论基于 DOM 属性与计算样式推断；未在 Firefox / Safari 交叉验证。
