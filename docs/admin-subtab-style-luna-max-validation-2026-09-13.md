# 后台子 tab 样式重构验证记录

日期：2026-09-13
仓库：`E:\Developments\Projects\zhi-zhou`
执行手册：[`admin-subtab-style-luna-max-execution-manual-2026-09-13.md`](./admin-subtab-style-luna-max-execution-manual-2026-09-13.md)

## 执行环境

- 实际起始 SHA：`75e1d1b035b556409af54295cc49f4f68890dc92`。
- 本轮变更通过本地 Git 提交固化；没有推送、部署或版本升级。
- 实施前工作区只有未跟踪的 `docs/`；本次本地提交纳入本轮 19 个后台源码/CSS 文件与本手册、本记录，没有清理其他文件。
- 浏览器使用已有本地服务 `http://localhost:5173`，Codex In-app Browser；首次抽查视口约 `1186×698`，重开标签后受宿主侧栏影响观测到约 `747×634`，两者都不是可控设备尺寸。接口返回本地真实种子数据，没有删除鉴权、伪造会话或使用 mock。
- 曾尝试启动第二个 Vite 实例以确认服务脚本，因 5173 已占用而监听 5174；该临时进程在收尾时停止，不作为验收服务。
- 运行环境可访问管理员数据：小说 396 本、章节 35,540、用户 4、书源 816 条等；因此本轮能够做桌面结构和真实数据 DOM 抽查。
- 未发现仓库根目录或后台适用的 `AGENTS.md`；`node_modules/recharts/AGENTS.md` 不属于本项目规则。

状态含义：`implemented` 表示代码已经完成并通过静态检查；`verified` 还要求适用行为和浏览器证据。本轮对目标页以 `implemented` 记录，浏览器完成了多页真实数据结构抽查；没有把未点击的保存、删除、生成和弹窗流程写成“全部 verified”。

## P0–P7 实施摘要

- **P0：** 在 `AiTab.tsx`、`scrape/index.tsx`、`SettingsTab.tsx`、`SiteOperationsTab.tsx` 建立有效 URL/持久化子页的标题元数据映射；深链首次渲染直接使用有效子页，避免父级标题或短暂错误标题。`SourcesView` 保留自己的操作页头，父级不再重复渲染“书源管理”。
- **P1（T01–T04）：** 账户用户、登录审计、操作审计和客户端监控补齐 `AdminToolbar`、`AdminDataPanel` 及真实 `data-label`/`data-primary`/`data-actions` 字段契约；审计筛选条移到面板外，原查询、分页、刷新和状态更新保留。
- **P2（T05–T08）：** 任务队列补充任务/下载日志列宽元数据；AI 任务、调用审计和已生成内容统一外置筛选条与平面面板；调用审计展开详情、生成内容批次、长文弹窗、轮询、取消/重试/删除和深链 props 保留。
- **P3（T09）：** 书源管理沿用现有导入、检测和 10 列原生表格，只由抓取父容器提供正确的“书源管理”页标题；现有筛选、批量动作、连接检测和弹窗结构未改。
- **P4（T10–T14）：** 注册/邀请码、代理设置、安全策略、AI 配置、参数调优统一面板表面和字段节奏；邀请码、代理日志和账户表格补齐移动字段契约；即时保存、草稿/生效值、密钥遮罩、数值范围和保存边界保留。
- **P5（T15–T17）：** AI 创作、封面生成使用统一平面卡片；抓取中心保留多步骤工作流和 `view=discover` 兼容，只修正父标题、局部面板和密度。
- **P6（T18–T22）：** 总览、AI 用量、运营概览/流量/内容使用统一面板令牌；AI 用量四项统计迁移到 `AdminMetricStrip`；运营三个 view 依据有效 URL 显示当前子页名，图表、CSV 导出、公告和分类详情流程保留。
- **P7：** 完成本记录、全量类型/测试/构建/ESLint/差异检查，并做固定范本与代表性目标页的真实本地浏览器 DOM 抽查。

## 页面清单

| ID | 页面 | 状态 | 变更文件 | 桌面/移动/暗色证据 | 行为验证 | 未验证项 |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | 用户管理 | implemented | `SettingsTab.tsx`、`admin-operations.css` | IAB `/admin/settings?view=users`：标题“用户管理”；4 行真实用户；`account-users-panel` 含“用户/角色/状态/注册/最近登录/想法”标签和操作列 | typecheck、tests、build、ESLint；受控读 DOM 确认 primary/action 字段 | 未执行角色切换、禁用、分页；未取得窄屏/暗色截图 |
| T02 | 登录审计 | implemented | `SettingsTab.tsx`、`admin-operations.css` | IAB `/admin/settings?view=audit`：外置 `account-audit-toolbar`，20 行审计，结果/原因/IP/User-Agent/时间标签 | 原筛选值、offset 分页和刷新 handler 保留；静态 DOM 确认表头与字段顺序 | 未切换结果筛选、未打开详情或跨页；窄屏/暗色待验 |
| T03 | 操作审计 | implemented | `SettingsTab.tsx`、`admin-operations.css` | IAB `/admin/settings?view=operation-audit`：外置 `account-operation-audit-toolbar`，20 行真实记录，7 列标签 | 原状态筛选、分页、刷新、重放字段和错误映射保留；effect 改为跟随有效 view | 未执行重放/失败恢复；窄屏/暗色待验 |
| T04 | 客户端监控 | implemented | `MobileTelemetryTab.tsx`、`admin-operations.css` | IAB `/admin/mobile-telemetry`：28 行事件，工具栏外置，5 列字段标签，事件列为 primary | 原状态筛选、搜索、刷新和状态更新 handler 保留；表格 columns 与 DOM 标签一致 | 未提交状态更新；窄屏/暗色、属性展开待验 |
| T05 | 任务队列 | implemented | `JobsTab.tsx`、`admin-operations.css` | IAB `/admin/jobs`：任务/下载日志两个面板和完整表头；当前真实数据为空态，未误显示虚假任务 | 轮询、取消、重试、下载日志刷新和空态 `colSpan` 保留；columns 仅提供既有列宽 | 未触发轮询中的任务、取消/重试和下载日志数据；窄屏/暗色待验 |
| T06 | AI 任务 | implemented | `AiTab.tsx`、`ai/AiTasksPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=tasks`：标题为“AI 任务”，外置 `ai-tasks-toolbar`，平面任务面板 | `currentSubTab` 直接响应深链；轮询、批次跳转、取消/重试/删除 handler 未改 | 未触发任务操作和进行中轮询；窄屏/暗色待验 |
| T07 | 调用审计 | implemented | `AiTab.tsx`、`ai/AiAuditPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=audit`：50 行真实调用记录，外置 `ai-audit-toolbar`，原生表格表头保持 | 类型筛选、分页、展开详情、Token/图片/费用字段保留；没有强行转换展开行 | 未点击展开详情或筛选；窄屏/暗色待验 |
| T08 | 已生成内容 | implemented | `AiTab.tsx`、`ai/AiGenerationsPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=content`：15 行生成记录，外置 `ai-generations-toolbar`，平面内容面板 | `scope`、`status`、`focusBatchId`、批次展开、审阅/编辑/删除和长文弹窗 props/handler 保留 | 未打开批次和长文弹窗；深链批次需专项复验，窄屏/暗色待验 |
| T09 | 书源管理 | implemented | `scrape/index.tsx`、`admin-operations.css`（`SourcesView.tsx` 结构保留） | IAB `/admin/scrape?view=sources`：唯一页头“书源管理”，816 条书源，外置筛选/导入工具栏，10 列原生表格 | full/partial/unsupported/enabled 筛选、导入、连接检测、批量操作和编辑弹窗调用链未改 | 未执行导入、检测、删除；来源长 URL 和弹窗窄屏/暗色待验 |
| T10 | 注册与邀请码 | implemented | `SettingsTab.tsx`、`admin-operations.css` | IAB `/admin/settings?view=registration`：标题“注册与邀请码”，配置卡与 `account-invites-panel`，邀请码字段标签存在 | 注册模式保存、生成/复制/停用、用量状态和切换 view 的 state 保留 | 未执行保存、复制、停用；窄屏/暗色待验 |
| T11 | 代理设置 | implemented | `scrape/index.tsx`、`scrape/ProxyView.tsx`、`admin-operations.css` | IAB `/admin/scrape?view=proxy`：配置/测试/日志 3 个平面面板，日志 4 行含时间/范围/目标/链路/结果/耗时标签 | 环境变量优先、保存草稿、连通测试、路由检查、日志刷新及独立 loading 保留 | 未发起真实代理测试或保存；长 URL、窄屏/暗色待验 |
| T12 | 安全策略 | implemented | `ContentPolicyTab.tsx`、`admin-operations.css` | IAB `/admin/content-policy`：单一 `content-policy-panel`，字段控件可见，保持合理最大宽度 | 即时保存请求、saving 禁用和失败 toast 逻辑未改 | 未切换开关；窄屏/暗色待验 |
| T13 | AI 配置 | implemented | `AiTab.tsx`、`ai/AiConfigPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=config`：供应商/策略/健康 3 个平面面板，密钥字段仍由原组件遮罩 | 供应商/模型、密钥不清空、测试/保存 handler 保留；深链标题正确 | 未保存或测试供应商；窄屏/暗色待验 |
| T14 | 参数调优 | implemented | `AiTab.tsx`、`ai/AiParamsPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=params`：6 个参数面板、18 个控件，标题为“参数调优” | 所有输入范围、默认值、枚举、dirty 与保存范围保留；长文本仍为 textarea | 未修改/保存参数；窄屏长表单、暗色待验 |
| T15 | AI 创作 | implemented | `AiTab.tsx`、`ai/AiWritingPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=writing`：标题为“AI 创作”，统一 `ai-writing-card`，8 个输入控件 | 新写/续写、小说/章节上下文、画像请求、生成前校验和任务跳转未改 | 未开始真实生成；草稿切模式、处理中/失败和窄屏/暗色待验 |
| T16 | 封面生成 | implemented | `AiTab.tsx`、`ai/AiCoverPanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=cover`：统一 `ai-cover-card`，图片预览 2 张，3 个控件 | 图片比例、候选选择/应用/弃用、生成反馈和确认流程未改 | 未执行生图或应用封面；图片弹窗、窄屏/暗色待验 |
| T17 | 抓取中心 | implemented | `scrape/index.tsx`、`admin-operations.css`（`CenterView`/`center/*` 结构保留） | IAB `/admin/scrape?view=center`：标题“抓取中心”，工作流入口和 3 个输入控件可见 | `view=discover` 兼容、链接/搜索/榜单、确认/章节校验/开始任务调用链未改 | 未走完整抓取任务；窄屏步骤堆叠、失败恢复、暗色待验 |
| T18 | 总览 | implemented | `DashboardTab.tsx`、`admin-operations.css` | IAB `/admin/dashboard`：真实指标、近期任务/小说和刷新按钮可见；状态页面板表面统一 | 指标加载、刷新、错误/空态和快捷入口 handler 保留 | 未点击刷新或快捷入口；窄屏/暗色待验 |
| T19 | 用量统计 | implemented | `AiTab.tsx`、`ai/AiUsagePanel.tsx`、`admin-operations.css` | IAB `/admin/ai?sub=usage`：4 项 `admin-metric-strip--ai-usage`，2 个图表面板，28 个 SVG 节点 | 成本、Token、调用次数单位；Recharts 趋势、日期范围和 loading/error 保留 | 未切换日期范围或 tooltip；窄屏图表高度、暗色待验 |
| T20 | 运营概览 | implemented | `SiteOperationsTab.tsx`、`admin-operations.css` | IAB `/admin/site-operations?view=overview`：标题“运营概览”，运营指标和卡片计算样式为 16px 圆角、无阴影 | 公告保存、健康度指标、刷新和 URL/持久化 tab 逻辑保留 | 未发布公告；窄屏/暗色待验 |
| T21 | 流量分析 | implemented | `SiteOperationsTab.tsx`、`admin-operations.css` | IAB `/admin/site-operations?view=traffic`：标题“流量分析”，4 项指标、4 个面板、27 个 SVG 图表节点 | 趋势范围、地区/设备/来源口径、tooltip 和数据来源保留 | 未切换 30/90 日或 tooltip；窄屏/暗色待验 |
| T22 | 内容分析 | implemented | `SiteOperationsTab.tsx`、`admin-operations.css` | IAB `/admin/site-operations?view=content`：标题“内容分析”，5 项指标、8 个卡片区域和 CSV 按钮可见 | 分类/质量/更新详情、作品列表弹窗、CSV 导出、URL/持久化 tab 逻辑保留 | 未点击分类详情或导出；弹窗、窄屏/暗色待验 |

## 范本回归

- **小说管理（`/admin/novels`）：** 浏览器真实数据抽查通过。标题为“小说管理共 396 本 · 第1/20页”，20 行列表，`admin-data-panel--grid` 和“标题/作者/分类/状态/章节/更新”字段标签存在；计算样式与账户表格一致为平面白色面板、16px 圆角、无阴影。没有改动小说范本的 handler、分页或编辑弹窗。
- **章节管理（`/admin/chapters`）：** 浏览器真实数据抽查通过。标题为“章节管理396 部作品”，目录面板和未选择小说的明确空状态正常；未选工作对象时没有伪造章节行。没有改动选择小说、目录操作或编辑/融合标题弹窗逻辑。
- **审核队列（`/admin/moderation`）：** 浏览器真实数据抽查通过。标题为“内容审核共 3 条”，外置 `moderation-toolbar` 在数据面板外，3 行真实记录含字段标签和 primary 字段；工具栏宽度约 882px、保持单独表面。未执行会产生修改的审核动作；“举报”模式的原因槽位与控件位置仍需手动切换确认。

## 共享组件与 CSS 变化

- `AdminWorkspace` 的列宽约定注释改为指向实际的 `admin-operations.css`，并明确 `AdminColumn` 只提供列宽元数据；调用方手写 DOM 字段标签，避免误以为 props 自动生成移动字段。
- 后台作用域新增工具栏外置表面、账户/监控/AI 目标页的列宽变量、面板/卡片 flat surface、透明外沿（`border: 0`）、20px 圆角、边缘铺满的标题区、标题区底部分隔线、代理日志局部滚动、AI 用量指标列和 `prefers-reduced-motion` 规则；保留 `data-theme` 主题桥接和现有断点 `900px`。
- 为用户、登录审计、操作审计、邀请码、客户端监控、任务/下载日志、代理日志补齐 `data-primary`、`data-label`、`data-actions`；复杂 AI 审计展开表继续使用原生表格和局部滚动，未强行卡片化。
- 修复 `admin-operations.css` 中原本会触发构建解析警告的孤立中文注释/选择器片段，使 CSS 构建只剩大 chunk 提示。

## 命令结果

| 阶段 | 命令 | 结果 | 关键输出/备注 |
| --- | --- | --- | --- |
| P0 基线 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 起始基线通过 |
| P0 基线 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 19 个测试文件、67 个测试 |
| P0 基线 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 有既有 CSS 解析警告和大 chunk 警告 |
| P0 基线 | `git diff --check` | 通过 | 起始无已跟踪 diff |
| P7 最终 | `npm run typecheck --workspace=@zhi-zhou/web` | 通过 | 19 个目标页及共享层类型通过 |
| P7 最终 | `npm run test --workspace=@zhi-zhou/web` | 通过 | 19 个测试文件、67 个测试 |
| P7 最终 | `npm run build --workspace=@zhi-zhou/web` | 通过 | 2633 modules；CSS 400.52 kB（gzip 61.62），Admin JS 823.78 kB（gzip 234.16）；仅有大 chunk 警告，原 CSS 解析警告已消失 |
| P7 最终 | `npx eslint`（本轮 TSX + `SourcesView.tsx`） | 通过 | 0 errors、23 warnings；warning 集中在 React hooks/ref 规则，未发现本轮 class/结构改造带来的错误 |
| P7 最终 | `npx prettier --check`（本轮 CSS、AdminWorkspace、两份 Markdown） | 通过 | All matched files use Prettier code style |
| P7 最终 | `git diff --check` | 通过 | 提交前暂存内容无 whitespace error |

## 浏览器验证边界

- 已使用真实本地管理员数据检查默认桌面视口的标题、工具栏位置、面板表面、字段标签、空态、指标和图表节点；AI、账户、抓取、运营各代表页的 URL 深链均能直接显示正确子页标题。
- 依据用户附图复核了章节目录卡片：当前渲染计算样式为 20px 圆角、外沿 `border: 0`、标题区底部约 0.8px 分隔线、状态胶囊约 37px 高；配置/AI 卡片的标题区也已从卡片边缘铺开，正文区由独立 padding 承担。章节未选择小说时空态最小高度为 400px，保持附图中的大留白和居中信息层次。
- CUA 当前没有提供 viewport override 能力，无法在本轮可靠地切到 1440×1000、1024×900、901/900、390×844、360px 并保存对照证据；因此不能把 CSS 媒体查询的静态存在写成移动端视觉通过。
- 本轮没有执行会写入或产生费用的保存、删除、停用、重放、代理测试、AI 生图/生成、抓取任务、CSV 下载，也没有打开需要重点检查焦点返回的弹窗；这些流程仍需在可控测试数据上验收。
- 亮色默认主题已抽查；暗色、非默认强调色、键盘 Tab/Shift+Tab/Enter/Escape、减少动态效果尚未逐页验收。
- 构建成功只证明编译和打包通过，不替代上述运行时视觉与业务操作验收。

## 明确遗留问题与下一步

1. 使用可控管理员测试数据，在 1440/1024/901/900/390/360 宽度和亮/暗主题各抽查三个范本及高风险目标页，确认断点、局部横向滚动、长 URL/长文本和操作列可达。
2. 按页面清单逐项执行非破坏性筛选、分页、刷新、展开/关闭和表单 dirty 检查；再在测试数据上执行保存、停用、重放、抓取和 AI 生成确认流程。
3. 重点补验审核“举报”模式的原因条件槽位、AI `focusBatchId` 深链返回、任务轮询取消/重试、代理环境变量优先级和运营分类详情/CSV 导出。
