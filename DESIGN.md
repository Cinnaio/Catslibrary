---
name: 知舟 (Zhi Zhou)
description: AI 中文小说阅读站 — 温暖纸质感的沉浸式书库
colors:
  primary: "#8B6045"
  primary-deep: "#74503A"
  primary-light: "#F0E6D6"
  primary-subtle: "#F8F3EC"
  surface: "#FFFFFF"
  surface-warm: "#F6F4F1"
  surface-hover: "#F5F2EE"
  text-primary: "#211E1A"
  text-secondary: "#5B554E"
  text-muted: "#736D65"
  border: "#ECE8E2"
  border-light: "#F3F0EB"
  focus-ring: "rgba(139, 96, 69, 0.24)"
  success: "#4F7A52"
  warning: "#B07C2F"
  danger: "#BE123C"
  seal: "#b8453a"
  dark-surface: "#1B1C20"
  dark-surface-warm: "#24252A"
  dark-surface-card: "#2A2B31"
  dark-text: "#E7E0D6"
  dark-accent: "#BF8F52"
  dark-border: "#3B3C43"
typography:
  heading:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontWeight: 700
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  serif:
    fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', ui-serif, serif"
  mono:
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace"
  # 枚举字号阶（机器可读字阶）。命名语义见正文 Typography 一节。
  scale:
    label-sm: "0.7rem"        # 11.2px 导航分组标签/后台 kicker（紧凑档下限）
    table-head: "0.72rem"     # 11.52px 表头/指标条标签
    label: "0.75rem"          # 12px 计数胶囊/元信息
    caption: "0.78rem"        # 12.5px 发现卡作者/描述
    body-compact: "0.8rem"    # 12.8px 表单标签/分页/排序
    source-toolbar: "0.82rem" # 13.1px 书源工具栏
    body-sm: "0.875rem"       # 14px 辅助文字/面板标题/页头描述
    select-trigger: "0.9rem"  # 14.4px 下拉触发
    card-title: "0.95rem"     # 15.2px 发现卡标题
    body: "1rem"              # 16px 正文/品牌标记/队列摘要数值
    modal-title: "1.15rem"    # 18.4px 弹窗标题
    panel-title: "1rem"       # 16px 后台卡片标题（小于 20px 页标题）
    stat: "1.45rem"           # 23.2px 指标条数值（AdminMetricStrip）——已全站停用，勿用于新页面
    page-title: "1.25rem"        # 20px 后台页标题固定字号
    hero-min: "1.35rem"       # 21.6px 公开页 hero clamp 下限
    hero-max: "1.9rem"        # 30.4px 公开页 hero clamp 上限
    display: "2rem"           # 32px h1
    # 阅读表面专属档（reader.css）。刻意高于后台紧凑字阶——长时间阅读优先舒适度。
    reader-body: "1.1rem"          # 17.6px 阅读器正文（移动端降到 body 1rem）
    reader-glyph: "1.35rem"        # 21.6px 阅读器图标按钮字符 / 移动端章节标题
    reader-title-min: "1.55rem"    # 24.8px 章节标题 clamp 下限
    reader-title-max: "2.15rem"    # 34.4px 章节标题 clamp 上限
    reader-watermark-min: "3rem"   # 48px 纸张「读」字水印 clamp 下限
    reader-watermark-sm: "3.2rem"  # 51.2px 移动端水印定值
    reader-watermark-max: "6rem"   # 96px 纸张「读」字水印 clamp 上限
rounded:
  sm: "6px"              # --radius-sm — 公共页控件
  base: "8px"            # --radius — 全局基础圆角
  md: "10px"             # --radius-md — 紧凑控件/卡片；也是 shadcn 桥接层 --sh-radius
  lg: "12px"             # --radius-lg — 后台控件与分段 tabs 药丸
  xl: "16px"             # --radius-xl — 嵌套表面/对话框/shadcn Card
  2xl: "20px"            # --radius-2xl — 后台大面板/数据面板/后台卡片
  full: "9999px"
  reader-paper: "30px"   # 阅读页纸张表面，移动端 24px；见 --reader-radius-paper
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.surface-warm}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "8px 8px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: 知舟 (Zhi Zhou)

## Overview

**Creative North Star: "The Paper Sanctuary"**

知舟的设计语言来自一个简单的感觉：在温暖的光线下翻阅纸质书。界面是安静的，像书房里被台灯照亮的纸页——没有刺眼的对比，没有冰冷的玻璃感，只有柔和的奶油色地面和深沉的墨色文字。这不是一个"科技产品"的界面，而是一个"阅读空间"的界面。

色彩来自奶茶和旧书页：暖棕作为唯一的强调色（像书脊上的烫金字），大面积使用接近白色的暖灰和奶油色作为呼吸空间。阴影克制而自然，像纸页层叠投下的微光。组件有微妙的触觉感——圆润但不幼稚，边框细致如精装书的切边。

系统里有两种读者：沉浸的阅读者和高效的运营者。公共阅读页服务于前者，管理后台服务于后者。两者共享同一套色调、字体和材质，但密度完全不同——后台把信息压到紧凑档以便扫描，阅读页把字号放大到舒适档以便久读。两种模式的边界是明确的，字阶与间距各自成档、互不外溢。

**Key Characteristics:**
- 奶茶色暖调贯穿，拒绝冷色和高饱和度
- 纸质感地面（接近白色的暖灰），文字如墨迹
- 阴影极简，依赖色调层次而非投影创造深度
- 系统字体 + 衬线字体用于阅读场景
- 组件触感温暖，圆角适度，像精心制作的文具
- 后台是同一世界的紧凑档：同一套 token，更高的信息密度

## Colors

暖调奶茶色板，以唯一的棕色强调色（#8B6045）锚定视觉重心，大面积中性暖灰提供呼吸空间。

### Primary
- **Milk-Tea Brown** (#8B6045): 强调色，用于链接、按钮、活跃状态、品牌标记。像精装书封面上的烫金字——稀有而有分量。
- **Espresso Ink** (#211E1A): 正文主色，接近深棕黑。用于标题和正文，不是纯黑而是带暖调的墨色。

### Neutral
- **Clean Paper** (#FFFFFF): 最浅的纸面，用于卡片和弹层背景。
- **Warm Linen** (#F6F4F1): 微暖的灰白，用于页面地面和次级背景。
- **Hover Tint** (#F5F2EE): 悬停态背景，比 Warm Linen 再暖一度。
- **Faded Parchment** (#9A938A): 弱化文字的历史值。当前 `--text-muted` 是 #736D65（白底 5.11:1），刻意加深以满足 AA——不要再改回更浅的 #9A938A。
- **Warm Gray-Brown** (#5B554E): 次要文字，用于非强调的说明文字。
- **Border Mist** (#ECE8E2): 边框和分隔线，极淡的暖灰。
- **Border Frost** (#F3F0EB): 比 Border Mist 更淡，用于表格行内侧分隔。

### Admin Surfaces
后台表面全部从上面这套色板派生，而不是另建一套颜色。亮色表面参考 Claude 官网的暖白底和克制强调色用法，但不复用 Claude 品牌色；知舟奶茶棕仍负责品牌、主要操作与选中状态。它们定义在 `:root`，但公开页面不引用；明暗主题和用户自定义强调色都会沿用同一套关系重新计算。

- **Admin Canvas** (`color-mix(in srgb, var(--bg-secondary) 55%, var(--border) 45%)`): 后台画布底色 `--admin-canvas`，使用可辨识的灰米色地面拉开与白色内容的明度差；暖色保持低饱和，不铺成深灰棕。
- **Admin Panel** (`var(--bg-card)`): 普通面板与弹窗的表面基色 `--admin-panel`；数据表面另走 `--admin-table-background`，侧栏另走 `--admin-sidebar`。
- **Admin Table** (`color-mix(in srgb, var(--bg-card) 96%, var(--accent-subtle) 4%)`): 表格内容区使用 `--admin-table-background`，保持接近纸白，让行内容成为后台阅读的主层。
- **Admin Table Header:** 表头使用 `--admin-table-header-background`。亮色主题以 85% 次级背景混合 15% 品牌强调色，形成奶茶棕暖调（默认约 `#E6DED7`）；暗色主题以 85% 表格内容底色混合 15% 弱化文字色，形成中性炭灰（默认约 `#3D3C3E`），与表格行保持清晰层级并去掉棕金偏色。文字仍使用 `--admin-table-header-foreground`。
- **Admin Panel Muted** (`color-mix(in srgb, var(--bg-secondary) 78%, var(--accent-subtle))`): 胶囊、弹窗页脚、次级表面 `--admin-panel-muted`。
- **Admin Sidebar** (`color-mix(in srgb, var(--bg-card) 70%, var(--admin-canvas) 30%)`): 侧栏与移动抽屉底色 `--admin-sidebar`，使用接近 `#FBFAF8` 的轻暖白，与灰米画布形成柔和分层；颜色仍由公共面板色和后台画布派生，品牌棕保留给导航选中态。暗色主题继续使用 58% 面板底色与 42% 主背景混合，形成稳定的炭灰导航层。
- **Admin Border** (`color-mix(in srgb, var(--border) 88%, var(--text-primary) 4%)`): 后台通用描边 `--admin-border`。
- **Admin Border Strong** (`color-mix(in srgb, var(--border) 62%, var(--text-primary) 15%)`): 后台控件与弹窗描边 `--admin-border-strong`，比通用描边更明确，用于输入框这类需要被看见边界的元素。

### Semantic
- **Reading Green** (#4F7A52): 成功状态。柔和的书页绿，不刺眼。
- **Amber Warning** (#B07C2F): 警告。旧纸般的琥珀色。
- **Vermilion Danger** (#BE123C): 危险操作。传统朱砂红。
- **Collector's Seal** (#b8453a): 收藏印章色，用于"已收录"标记。

### Dark Theme
暗色模式不是反转，而是"月光下的书房"：深灰地面（#1B1C20）替代白色纸面，金色强调色（#BF8F52）替代棕色，文字变为暖白（#E7E0D6）。所有语义色相应提亮。机制是 `[data-theme="dark"]`，不是 `.dark` 类；`@custom-variant dark` 只负责把它桥接给 Tailwind。

### Named Rules
**The 10% Accent Rule.** 奶茶棕色强调色在任何页面上不超过 10% 的面积。它的稀有性就是力量——读者的眼睛自然被引导到最重要的交互点。

**The Derived-Surface Rule.** 后台表面永远是 `color-mix` 派生自公开色板的结果，不新开一套颜色。画布负责压低明度，表格负责承载阅读，表头和侧栏负责传递品牌——新表面要先问"它是哪两个既有 token 的混合"，答不上来就不要加。暗色主题保持相同的层级顺序，不机械反转明暗关系。

## Typography

**Display/Body Font:** System sans-serif stack (-apple-system, PingFang SC, Microsoft YaHei)
**Serif Font:** Noto Serif SC / Source Han Serif SC (阅读器场景)
**Mono Font:** SF Mono / Fira Code / Consolas

**Character:** 系统字体带来原生、安静的感觉——不抢注意力，让内容本身成为视觉主角。衬线字体在阅读器中营造纸质书的氛围。

### Hierarchy
- **Page Title** (700, `var(--admin-page-title-size)` → 20px, 1.15): 后台页标题（AdminTabHeader 的 h2），保持紧凑固定字号，`letter-spacing: -0.04em`。它是页面上最大的文字，也是唯一的页面级标题。
- **Panel Title** (750, 1rem / 16px, 1.3): 后台卡片标题（AdminPanelHeading 的 h3），`letter-spacing: -0.03em`。必须小于 20px 页标题，卡片层级不能与页面标题持平或反超。
- **Stat Value** (750, 1.45rem, 1): 指标条数值（AdminMetricStrip 的 strong），与 11.52px 标签形成尺寸断裂——全后台唯一的"大数字"层级。队列摘要用更小的 1rem，因为它与说明文字同处一个信息块，抬到 1.45rem 会撑破那块版面。
- **Headline** (700, 2rem, 1.3): h1，用于页面级标题，letter-spacing: -0.02em。
- **Title** (600, 1.3rem, 1.3): h2，段落标题。
- **Body** (400, 16px, 1.6): 正文。行高 1.6 提供舒适的阅读节奏。
- **Label** (750, 0.7–0.72rem, 0.08–0.1em uppercase): 分类标签。后台 kicker 用 0.72rem / 750 / 0.08em，侧栏分组标签用 0.7rem / 0.1em + uppercase。两者都压在 11px 可读下限之上，不再往下调。
- **Compact Label Scale (Admin)** (400-750, 0.7-0.8rem): 管理后台专属的紧凑密度字号阶梯，用于 OPERATE 模式的高信息密度扫描。包括：导航分组标签 (0.7rem)、kicker (0.72rem)、表头 (0.72rem + 0.07em)、计数胶囊 (0.75rem)、元信息 (0.75rem)、分页 (0.8rem)。这一档刻意低于公开阅读界面的字号——管理控制台优先扫描效率，阅读界面优先舒适度。**对比度不可妥协**：弱化文字须满足 AA ≥4.5:1，数据读取面（表头/内容）字号 ≥11px。
- **Reading Surface Scale (Reader)** (`reader.css`，与上一档相反的方向): 阅读页有自己的一档字号，全部高于通用档。正文 1.1rem/行高 2.05（移动端降到 1rem/1.85），章节标题 clamp(1.55rem, 3vw, 2.15rem)、移动端定值 1.35rem，纸张右上角的「读」字水印 clamp(3rem, 8vw, 6rem)、移动端 3.2rem。**这一档只在 `.reader-app` 内生效**，不得外溢到公共页或后台；反过来，阅读器内也不使用后台的紧凑档。

后台表单标签另有 `--admin-field-label-weight: 400`——标签刻意保持常规字重，让当前选中的分段 tab 保持视觉主导；不要用加粗标签去和 tab 抢注意力。

### Named Rules
**The Content-First Rule.** 字体永远是配角。系统字体不创造风格，内容本身创造风格。唯一例外是阅读器中的衬线体——那是为沉浸而存在的。

**The One Title Rule.** 每个可导航页面只有一个内容区主标题，由页头承担。面板标题写工作对象名（"作品目录"、"章节目录"、"审核列表"），不重复页面名。页头上方不再出现小字眉题——`AdminTabHeader` 的 `kicker` 与 `hero` 变体已退役，两个 prop 仍被接受但被忽略。标题字号膨胀和"每页一个更大的标题"都是被明确否定的方向。

**The Single-Door Rule.** 一个动作只开一扇门。页头上的操作作用于整页（搜索、新建），面板工具条上的操作作用于那一份数据（筛选、批量、清除）；同一个动作在两处都出现，读者就要先判断"我点的是哪一个"。分级管理页的「刷新账本」因此只留在页头，面板内不再重复。

**The No-Third-Pass Rule.** 同一个统计值在一屏里最多出现两次，并且每次都应靠近所属面板、筛选器或分页区；页名行不承载规模摘要或状态。若某个读数已在面板状态和分页区表达，就不能再另起一块表面；唯一例外是**贴在筛选器旁边的缺口读数**（「待标注 67 · 限制级 340」），因为它与下拉是同一件事的两种表达，且能被那个下拉直接筛出来。

## Admin Page Anatomy

后台**一个 tab 一个内容区主标题**。主标题由 `AdminTabHeader` 承担，与它下面的数据面板是两层不同职责的陈述：页头说**这是什么页**，面板标题说**这一块在干什么活**。

### 页头版式：单行账本式

页头是**一行**，不是两块堆叠（2026-09-25 收口，以小说管理为范本）。

- **左**：`h2` 页名独占标题行，描述放在标题下方；标题后不附加规模摘要、状态小字或竖向分隔线。
- **右**：该页的**看家动作**——搜索框与主操作按钮。桌面端 `width: fit-content` + `flex-wrap: nowrap`（标题在左、动作在右，中间留白）；900px 及以下动作区转 `width: 100%`、搜索框 `flex: 1 1 auto` 吃掉剩余宽度、按钮 `flex: 0 0 auto` 不被压缩。
- **无底线**：`border-bottom: 0`。与面板之间的区隔靠 `.admin-redesign-page` 的 1rem grid gap，不靠分隔线。
- **只放页面级动作**：搜索与「新建」这类作用于整页的动作归页头；筛选、批量、刷新某一份数据归面板工具条。两处都放同一个动作等于开了两扇门。
- **标题行不承载元信息**：规模数字与只读状态放在所属面板标题栏、筛选器旁或分页区；异常状态放在相关内容区域中。页头右侧只放页面级操作。

**已收口页面**：小说管理、章节管理、内容审核、分级管理、内容安全、站点运营（概览/流量/内容）、AI 服务（创作/封面/任务/已生成内容/用量/审计/配置/参数，页头由 `AiTab` 统一提供）、账户与注册（用户/注册/登录审计/操作审计）、后台总览。

几何规则按页名分组写在 `admin-operations.css`（`.admin-redesign-page--{content-ratings,content-policy,site-operations,ai}`），新增页面只需把自己加进那组选择器；不要各写各的动作区样式。

### 指标条已停用

**`AdminMetricStrip` 全站不再有页面调用**（2026-09-25 收口）。分级管理页率先移除，随后是站点运营三个子页、AI 用量统计、客户端监控、账户与注册、后台总览。组件本体保留在 `AdminWorkspace.tsx`（`admin-readability.test.tsx` 仍断言它的三段结构），但**没有任何页面再渲染它**。

理由：它把面板页头的几个字段抽出来、放大成 1.45rem 的独立表面，插在页头与面板之间。分级管理表里只有三个数字——总数、待标注、限制级——却占了完整一行、吃掉半屏高度；这些口径应贴近分级筛选与分页信息呈现。**同一个口径重复到第三次，就只剩噪音。**

- **数字必须与能筛出它、或汇总它的那块内容相邻**。分级账本保留「待标注 67 · 限制级 340」贴着分级下拉；AI 用量统计的「总调用 / 总成本 / 平均单次」贴着它汇总的那张趋势图（`.ai-usage-totals`，0.72rem 次级文字）。读数和控件是同一件事的两种表达，不是两块信息。
- **规模数字贴近所属内容**。站点运营的 PV / UV 与作品 / 分类读数放在对应的运营概览、趋势或分类面板中，不跟在页名之后。
- **判据**：任何概览读数若不能一键筛出它描述的数据、或已由所属面板状态 / 筛选器 / 页脚计数表达，就不该单独成块。
- **例外已取消**：DashboardTab 与 SiteOperationsTab 不使用独立指标条；统计值留在对应的面板和图表中，避免占据整行并把主要数据推到首屏以下。

### 身份线三段

面板标题（`h3`，写工作对象名）→ 面板内工具条（搜索 / 筛选 / 批量）→ 数据区（表格 / 列表 / 页脚）。三者同属一份数据，默认同处一个 `AdminDataPanel` 盒子内；当页面需要把工作对象说明与数据操作明确拆开时，使用下面的双表面结构。

### Admin Card Heading

- **Title:** 后台卡片标题统一使用 `AdminPanelHeading` 或同级卡片标题，字号读取 `--admin-section-title-size`（16px），低于 20px 页标题；保留清楚的 700–750 字重。
- **No divider:** 标题区与卡片正文之间不画横向分界线。工具条、表格或正文内部需要分段时，只保留对应内容区的分隔线。
- **Title only:** 卡片标题行只写工作对象名，不在标题下放注释性副标题，也不在主标题前放 SVG 图标。右侧只保留实时状态、有归属的数据读数或可执行控件；静态快捷键、提示标签和装饰性徽标移入正文（确有需要时）或删除。必要说明放回字段帮助或正文，不作为卡头副标题。
- **Coverage:** 该规则适用于所有后台 tab 的数据面板、配置卡和运营卡；新增卡片沿用共享样式，不建立页面专属标题例外。
- **Workflow spacing:** 当卡片标题后紧接模式选择或表单时，标题到首个控件、模式选择到字段各保持约 12px 的组间距；不要叠加通用卡头底内距与正文上外距制造空档。输入要求、操作前提等必要说明留在对应字段下方，并精简到完成当前动作所需的信息。

### Compact Utility Panel

少量次级操作（例如配置导入/导出）使用共享 `.admin-utility-panel`：桌面端标题靠左、操作组靠右并保持同一行；最小高度为 `4.75rem`，内容换行时可自然增高，不增加注释性副标题或卡头分割线。卡片之间的距离只由页面父级布局控制，避免子卡片再叠加外边距。屏幕宽度不超过 640px 时标题与操作组纵向排列，按钮顺序不变并允许换行。该规则用于轻量工具区，不替代表单流程卡或数据面板布局。

- **`AdminPage` 是容器契约**：它提供 `.tab-content` + `.admin-redesign-page`（统一区块间距、卡片表面归一化，不可省略），并接收 `title` / `description` / `actions` 三个 prop 转交 `AdminTabHeader`。子视图自带页头时传 `title={undefined}` 关闭父级页头（`scrape` 的书源子页即此用法）。

### 双表面数据工作区

当列表页同时包含“这份数据是什么”的说明和“如何操作这份数据”的高频控件时，说明面板与数据面板必须拆成两个相邻但职责不同的表面，结构固定为：

`AdminPage` 页头 → `AdminContextPanel` 说明面板 → `AdminDataPanel` 数据面板。

- `AdminContextPanel` 只承载工作对象标题和辅助说明，使用 `--admin-context-panel-*` token；它是独立的嵌套表面，保留 1px 暖色描边，不加阴影。
- `AdminDataPanel` 只承载 `AdminToolbar`、选择条和表格/列表，使用 `--admin-data-panel-*` token；表格卡片保持无外描边，内部只用分隔线表达区段。分页默认属于面板；需要像小说管理这样形成独立控制行时，`Pagination variant="detached"` 放在 `AdminDataPanel` 外部，且不使用卡片背景、边框或圆角。
- 两个表面之间的距离统一使用 `--admin-page-section-gap`。不要把说明重新塞回数据面板，也不要为工具条再创建第三张等权卡片。
- 图一式的拆分不改变分页、筛选、批量操作、空状态或移动端 900px 卡片化契约；它只把说明与操作的阅读顺序变成“先理解对象，再处理数据”。
- 如果页面没有需要保留的工作对象说明，且只剩一个高频筛选器，不要为了填补层级强行创建 `AdminContextPanel`；使用下方“单筛选外置行”例外。

## Layout

内容驱动的流式布局，最大宽度 1200px（--max-width-content），阅读器收窄到 680px（--max-width-reader）。

- **公共页面**: 居中容器，20px 内边距，纵向流动。小说网格使用 auto-fill + minmax(330px, 1fr)，间距 36px × 44px。
- **管理后台**: 左侧可折叠侧边栏 + 右侧内容区。侧栏是 shadcn Sidebar（`collapsible="icon"`, `variant="floating"`），展开态 16rem、图标态 3rem、移动抽屉 18rem。桌面侧栏保留轻微外部留白、圆角与独立纸面，但不使用外描边或阴影；内容区宽度 `min(100%, 1440px)` 居中，内边距 1.5rem（桌面）/ 1rem（640px 以下）。滚动所有权在 `AdminShell` 的内容区，不在各 tab 内部。
- **响应式断点**: 901px↑ 启用桌面固定列宽；900px 是主转折（表格折成卡片、工具栏转纵向、侧边栏折叠、网格单列）；640px 紧凑间距与页头收缩；400px 按钮全宽。审核工具条另有 1240px 的转纵向断点。
- **间距节奏**: 全局 4/8/16/24/32/48px（xs → 2xl）；管理后台使用 `--admin-space-1` 到 `--admin-space-6` = 4/8/12/16/24/32px。后台的第三档是 12px 而不是 16px——这是紧凑档与全局节奏的刻意差异，不要用全局档去覆盖后台面板的内部间距。双表面工作区的兄弟表面间距固定读取 `--admin-page-section-gap`，当前为 16px。

## Elevation & Depth

阴影极其克制——这个系统依赖色调层次（tonal layering）而非投影来创造深度。阴影仅在两个场景出现：弹出层（modal/popover）和管理后台的全局阴影。

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgba(40,32,24,0.04), 0 1px 3px rgba(40,32,24,0.05)`): 卡片和按钮的静态投影，几乎不可见——像纸页微微浮起。
- **Elevated** (`0 6px 16px rgba(40,32,24,0.08)`): 悬停态和次要弹层。
- **Modal** (`0 24px 70px rgba(40,32,24,0.18)`): 模态对话框，最重的阴影但仍保持暖调。
- **Admin Ambient** (`0 18px 48px rgba(40,32,24,0.10)`): 管理后台浮起表面的全局阴影 token `--admin-shadow`。
- **Admin Soft** (`0 10px 26px rgba(40,32,24,0.07)`): 轻量后台表面 `--admin-shadow-soft`。

后台的数据面板和卡片在静止态**不使用**上述阴影：`--admin-panel-card` 与 `.admin-data-panel` 都是 `box-shadow: none`，靠 `--admin-panel` 的表面色与 `--admin-border` 描边分层。后台阴影只留给真正浮起的元素（弹窗、下拉、抽屉）。

### Named Rules
**The Flat-By-Default Rule.** 所有表面在静止状态是平的。阴影仅作为状态响应出现（hover、elevation、focus），或为弹出层提供层次暗示。

**The Tonal-Admin Rule.** 后台一个像素的阴影都不要加。面板靠表面色 + 1px 描边区分层次；一旦给数据面板加投影，它就会在密集列表里看起来像浮起的卡片，破坏扫描。

## Shapes

圆角策略温和而一致：公共控件 6px（--radius-sm），全局基础圆角 8px（--radius），紧凑控件与卡片 10px（--radius-md），管理后台控件与分段 tabs 药丸 12px（--admin-button-radius / --admin-input-radius / --radius-lg），嵌套表面与对话框 16px（--radius-xl / --admin-radius-dialog），后台大面板与 `.admin-panel-card` 20px（--radius-2xl）。分段 Tabs 另有明确的内外弧线契约：外框 12px、3px 内缩、激活表面 9px，统一由 `--tabs-segmented-*` token 提供。

- **公共控件圆角 (6px)**: 公共页按钮、输入框、标签、复选框——足够圆润但不接近圆形，像文具的倒角。
- **shadcn 控件圆角 (10px)**: shadcn/ui 基类（button/input/dialog）用 `rounded-md`，经 `shadcn.css` 的 `@theme inline` 桥接到 `--sh-radius`（即 `--radius-md` = 10px）。这是 Tailwind 与站点 token 的接缝，也是唯一一处"工具类默认值不等于同名 CSS 变量"的地方——调整前台圆角时先看这里，不要改 Tailwind 工具类。
- **管理后台控件圆角 (12px)**: 后台的按钮、输入框、表单控件与 tabs 药丸统一 12px。作用范围是 `.admin-layout` 下的 `[data-slot='button']`、`[data-slot='input']`、`[data-slot='textarea']` 等，公开页面不受影响。
- **卡片圆角 (10px)**: 紧凑卡片与旧版表格包裹器使用 `--radius-md`。
- **嵌套表面与对话框圆角 (16px)**: shadcn `Card`（`rounded-xl`）、对话框、嵌套表面。
- **后台大面板圆角 (20px)**: 数据面板（`--admin-table-panel-radius`）、`.admin-panel-card`——更明显的圆润感，像精装书的封面弧度。
- **公开页面结构归并**: 紧凑字段使用 `--radius-md`，控件与菜单使用 `--radius-lg`，内嵌卡片、浮层与对话框使用 `--radius-xl`，Hero 与大卡片使用 `--radius-2xl`；公开页面不再直接新增 11/13/14/15/17/18/22/24/26/28/30px 档位。
- **全圆角 (9999px)**: 胶囊标签、计数徽章、状态条——仅用于信息密度极高的辅助元素。
- **阅读页纸张圆角 (30px / 移动端 24px)**: `--reader-radius-paper`，唯一大于 2xl 的圆角。阅读表面要读起来像"一张纸"而不是一个卡片，弧度必须明显大过周围的控件；只用于 `.reader-paper`，其余阅读页元素仍走上面的通用档。

## Components

组件以 shadcn/ui 为基础，通过 CSS custom properties 桥接到知舟的暖色调系统。后台组件另有一套 workspace 原语（`components/admin/AdminWorkspace.tsx`）：`AdminToolbar`、`AdminSearch`、`AdminContextPanel`、`AdminMetricStrip`、`AdminQueueSummary`、`AdminDataPanel`、`AdminPanelHeading`。

### Buttons
- **Shape:** 公共页圆角 6px（--radius-sm）；管理后台圆角 12px（--admin-button-radius）。后台按钮最小高度 2.5rem（--admin-control-height），图标按钮不套用该高度。
- **Primary:** 奶茶棕背景（#8B6045）+ 白色文字，用于主要操作（保存、确认）
- **Secondary:** 暖灰背景（#F6F4F1）+ 深色文字，用于次要操作（刷新、取消）
- **Ghost:** 透明背景 + 次要文字色，用于图标按钮（表格行操作）
- **Destructive:** 危险红背景 + 白色文字，用于删除操作
- **Hover / Focus:** 背景色加深一档；键盘焦点是 3px 半透明暖色光晕（`--focus-ring: rgba(139,96,69,0.24)`，经 `--sh-ring` 桥接），并伴随边框变色。焦点态必须同时有颜色变化和光晕，不要只留光晕。

### Dialogs
- **Admin Dialog:** 后台弹窗统一 `.admin-dialog`：三行栅格（页头 / 可滚动正文 `.admin-dialog__body` / 页脚），最大高度 `calc(100dvh - 2rem)`，外框 16px（--admin-radius-dialog）。宽度按任务定——小说编辑 540px、章节编辑 620px、章节融合 760px——不把弹窗拉成同一个宽度。页头/页脚/关闭按钮由 `data-slot='dialog-*'` 契约配合 Radix 实现。
- **Header Alignment:** 页头一律居中，与 `DialogHeader` 的实际渲染一致（其 `text-center` 与 `sm:text-left` 中后者被 Tailwind 输出顺序压掉，居中才是既有事实）。标题避让右上角关闭按钮时用左右对称留白（`padding-inline`）而非只留右侧，否则居中标题会视觉偏左；描述块用 `margin-inline: auto` 跟随居中。
- **Scroll Ownership:** 一个弹窗只设一个滚动所有者。`.admin-dialog` 由 `.admin-dialog__body` 承担；自建三行栅格（如 `.ai-generation-dialog`）必须显式指定中间滚动区，且**不得**依赖外层 `overflow: hidden` 裁切——超出内容会被静默截断且无法滚动恢复。长正文（数千字）用固定高度或视口相关上限 + 框内滚动，不随内容长高。
- **Hidden Scrollbar:** 弹窗内不显示滚动进度条。`.admin-dialog` 及其全部后代读 `scrollbar-width: none` + `-ms-overflow-style: none`，并配 `::-webkit-scrollbar { display: none }`——base.css 的全局 8px 滚动条会在正文右缘切出一条与纸面异色的竖轨。滚动能力保留（滚轮、触摸、键盘照常），只隐藏进度条；正文与内嵌滚动区（章节列表、抓取日志、Prompt 预览）由一条通配后代规则统一覆盖，不逐个容器重复声明。
- **Segmented Surface:** 三段式栅格只区分结构，不区分颜色。页头、正文、页脚共用同一表面色 `--admin-panel`，页脚不得用 `--admin-panel-muted` 或任何加深底色，也不靠 `border-top` 分隔；末段与内容的界限只由间距（`--admin-space-*`）和按钮自身视觉承担。
- **Field Labels:** 弹窗内的小标题（`标题`/`作者`/`正文`…）统一为 12px / 500 / `--text-muted`，读 `--admin-dialog-label-size`·`-weight`·`-color`·`-line-height`·`-letter-spacing`。不再出现 0.8rem/650/次级色、0.6875rem/600/大写等分叉写法，也不用 `text-transform: uppercase`（大写只对拉丁字母可见，会让中英标签风格分叉）。覆盖范围含 `.admin-dialog` 与自建三段式的 `.ai-generation-dialog`；无 `Label` 元素可挂的裸 `div` 用 `.admin-dialog-section-label` 表达同一语义。
- **Helper Copy:** 控件下方的辅助说明与标签同尺寸同色，只降一档字重至 400（`--admin-dialog-hint-*`，或裸元素用 `.admin-dialog-hint`）。辅助说明不得比它说明的标签更粗或更大，否则主次颠倒。
- **Mobile Editor:** 窄屏小说编辑窗口使用 `--admin-dialog-mobile-max-height` 收紧高度；底部操作区通过 `--admin-dialog-mobile-footer-*` 保持保存/取消同一行、不换行，并用 `--admin-dialog-mobile-action-min-*` 保留触控尺寸。

### Segmented Tabs
- **Track:** 外框 12px（`--tabs-segmented-radius`），内缩和分隔间距 3px（`--tabs-segmented-inset` / `--tabs-segmented-gap`），轨道边框和底色使用消费方语义 token。
- **Label:** 标签统一使用 `--tabs-segmented-label-size`、`--tabs-segmented-label-weight`、`--tabs-segmented-label-line-height`（14px / 400 / 1.6）；选中态只切换到 `--tabs-segmented-active-foreground`，不额外改变字重。
- **Active Surface:** 激活表面 9px（`--tabs-segmented-inner-radius`），使用消费方的 surface 与 `--tabs-segmented-active-shadow`；未选中和选中文字分别使用 `--tabs-segmented-muted-foreground` / `--tabs-segmented-active-foreground`。
- **Motion:** 激活表面只用 `transform` 移动，不触发布局重排；时长、曲线和复合写法统一从 `--tabs-segmented-duration`、`--tabs-segmented-ease`、`--tabs-segmented-transition` 读取。默认是 180ms ease-out，必须在 `prefers-reduced-motion: reduce` 下将时长压到近乎 0。
- **Consumers:** 抓取入口、审核类型以及其他后台分段 Tab 只覆盖消费方表面色值；几何、激活层、文字状态和动效统一读取 `--tabs-segmented-*`，不再维护页面级圆角、内缩、间距和位移字面量。

### Cards
- **Corner Style:** shadcn `Card` 为 16px（`rounded-xl`）；说明面板使用 `--admin-context-panel-radius`（16px），后台数据面板使用 `--admin-data-panel-radius`（20px）
- **Background:** 白色/卡片色（var(--bg-card)），管理后台说明面板与数据面板分别使用 `--admin-context-panel-background` / `--admin-data-panel-background` 标准化
- **Shadow Strategy:** 静止无投影，hover 也不加（Flat-By-Default Rule + Tonal-Admin Rule）
- **Border:** 说明面板保留 `--admin-context-panel-border-width` 的 `--admin-context-panel-border` 描边；数据面板本身 `border: 0`，靠表面色分层，内部工具条/页头用 1px `--admin-border` 底线分区
- **Internal Padding:** 说明面板使用 `--admin-context-panel-padding`；数据面板工具条使用 `--admin-data-panel-toolbar-padding-block` × `--admin-data-panel-toolbar-padding-inline`，存在面板标题时仍使用 `1.5rem 1.5rem 1.25rem`

### Inputs / Fields
- **Style:** 管理后台输入框用 `--admin-border-strong` 描边、`--admin-panel` 底色、12px 圆角（--admin-input-radius），高度 2.5rem（--admin-control-height）。公共页保持 1px `var(--border)` + 6px 圆角。
- **Focus:** 边框切换到强调色或 `--ring`，外加 3px 半透明光晕——焦点是可见的颜色变化，不只是光晕。
- **Compact Variant:** `.admin-input--compact` 最小高度 34px（2.125rem），用于工具栏紧凑场景，与按钮一起取 12px 圆角。
- **Multiline:** 输入框的固定高度规则不得作用于 textarea。长提示词、章节正文、JSON 使用可伸缩的多行区域。

### Named Rules
**The Fit-Content Rule.** 输入框宽度随用途与提示信息而定，不设拉伸：短提示短框，长内容长框。避免 `flex-1` / `w-full` 把输入框撑满整行——工具栏里的过滤/搜索框用 `min-w` 限定下限、内容自然决定宽度，长 URL 输入才放宽。

**The Data-Panel Contract Rule.** 后台数据表一律走 `AdminDataPanel` + `columns`。`columns` 只做两件事：注入 `--col-N-w` 宽度变量、添加 `.admin-data-panel--grid`。它**不会**渲染单元格，也不会写 data 属性——调用方必须让「列定义顺序 = thead 顺序 = tbody 单元格顺序」三者一致，并手动标注 `data-primary` / `data-label` / `data-actions` / `data-check`。少写一个 `data-label`，那张卡片在 900px 以下就会缺一个字段标签；只传 `columns` 而不标属性，等于什么都没做。

### Navigation (Sidebar)
- **Style:** shadcn 可折叠侧边栏（`collapsible="icon"`, `variant="floating"`），展开态 16rem、图标态 3rem、移动端抽屉 18rem。桌面侧栏使用 `--admin-sidebar` 独立纸面，保留轻微外部留白和 `--radius-xl` 圆角，不使用外描边或阴影；不要把它改成边到边的 `sidebar` 变体。导航溢出时保留滚动能力，但隐藏滚动条视觉轨道。
- **Brand / Account:** 侧栏顶部品牌容器是返回首页的入口；账户菜单固定在侧栏底部，承载个人中心与退出登录。账户区域与上方导航之间使用 `--admin-sidebar-footer-fade-height` 的渐变过渡，不添加硬分隔线。
- **Active State:** 当前项使用整行 `--admin-sidebar-active-background` 品牌色背景与 `--admin-sidebar-active-foreground` 前景色，取消旧的局部浅色/竖线指示器；悬停态不得覆盖当前项的品牌色。
- **Typography:** 菜单项 0.875rem / 500；分组标签 0.75rem / 600，正常字距、不使用 uppercase，颜色 `--text-muted`。
- **Geometry Tokens:** 菜单项高度、圆角、内边距、图标与文字间距分别读取 `--admin-sidebar-nav-height`、`--admin-sidebar-nav-radius`、`--admin-sidebar-nav-padding-inline`、`--admin-sidebar-nav-gap`；分组顶部留白使用 `--admin-sidebar-group-gap`。

### Table
- **Admin Surface:** `AdminDataPanel` 是无外框、纸面色表面，使用 `--admin-data-panel-radius`（20px）外圆角；需要说明时，标题/说明属于相邻的 `AdminContextPanel`，不再与筛选和表格挤在同一张大卡片里。
- **Table Contract:** 表格内容区、表头、行分隔线、hover 背景和行高分别从 `--admin-table-background`、`--admin-table-header-*`、`--admin-table-border`、`--admin-table-row-hover-background`、`--admin-table-row-height` 读取。亮色表头以 85% 次级背景色混合 15% 品牌强调色，保留低饱和奶茶棕暖调；暗色表头以 85% 表格内容底色混合 15% 弱化文字色，形成中性炭灰层级，避免品牌金棕色让表头与表格内容过于接近。表头文字继续使用 `--admin-table-header-foreground`，保持正文对比度和排序状态清晰。小说表格的滚动容器裁切表头底色，并以 `--admin-data-panel-radius` 保留左右上角圆弧，避免表头底色盖平数据面板圆角。桌面端列宽由 `--col-N-w` 注入：`@media (min-width: 901px)` 下启用 `table-layout: fixed` 并逐列消费该变量，规则覆盖第 1–12 列；**第 13 列起没有对应规则**，落到剩余宽度分配。范本统一使用百分比列宽且合计 100%——fixed 布局下百分比与 rem 混用时，定长列会先吃掉宽度。
- **Breakpoint:** 900px 及以下是卡片化：thead 隐藏，`tr`/`td` 转 grid，`data-label` 变伪元素。与 901px↑ 的固定列宽成对，分界值是 900/901。
- **Container-Query Exception:** **已撤销（2026-09-19）**。该例外曾用于 `AiGenerationsPanel` 的已生成内容表：当时那张表脱离 `AdminDataPanel` 并自带 `min-w-[760px]`，901–1100px 视口下内宽只有 756px，表格溢出且 sticky 冻结的操作列整列压住「内容预览」（数据丢失），只能改由 `@container (max-width: 48rem)` 按容器宽度卡片化。该表现已收敛到标准契约（`fixed` 布局 + 百分比列宽），不再需要最小宽度，溢出从根上消失，`@container` 块与 sticky 冻结列一并删除。**结论：最小宽度是破损的根因，容器查询只是补丁——遇到同类问题先问「为什么需要这个固定宽度」，而不是先加一个容器查询。** 当前全站数据表统一走 900/901 视口断点，无例外。
- **Action Column Sizing:** 操作列宽度按**实测内容**反推，不套用固定百分比。判据是「同一行最宽的按钮组合能否单行放下」：文字按钮（如「查看章节」82px + 「删除」54px + 8px 间距 = 144px）比 32px 图标按钮宽得多，901px 视口（桌面固定布局最窄点）下若按图标按钮的 11% 分配，`td` 的 `overflow: hidden` 会把末位按钮整颗裁掉且不可点击。故文字按钮面板的操作列取 21%，并在该列解除固定行高（`height: auto` + `min-height: var(--admin-table-row-height)`）配 `flex-wrap`，使极窄容器下降级为换行而非裁切。范本小说表的图标按钮在同宽度下反而会裁切，属既有缺陷，**不要复制它的百分比**。
- **Mobile Stack:** 移动端使用 `--admin-table-mobile-stack-gap` 保持行间距为 0，行不绘制左右外部描线；首行取消顶线以接续标题区，内部行只保留单条 `--admin-table-mobile-stack-divider` 水平分隔，末行使用 `--admin-table-mobile-card-radius` 的底部圆角收束。
- **Data Details:** 分类标签间距使用 `--admin-table-tag-gap`，行操作区使用 `--admin-table-action-*`，排序按钮使用 `--admin-table-sort-*`；删除仅在 hover 时进入危险色。`.admin-cell-tags` 在桌面只显示前 3 个标签加 `+N` 徽章，900px 以下恢复全部并隐藏 `+N`——这是刻意的视口相关截断，完整列表始终对读屏可见。
- **Motion:** 面板进入使用 `--admin-table-surface-enter` + offset，前 8 行使用 `--admin-table-row-enter` + `--admin-table-row-stagger-step` 依次出现；行、排序箭头、图标按钮的状态反馈使用 `--admin-table-row-interaction`。`prefers-reduced-motion: reduce` 下取消行位移动效，仅保留短淡入。
- **Legacy Wrapper:** `.table-wrapper` 是旧版表格容器（10px `--admin-radius`、粘性表头），当前唯一消费者是书源表 `scrape/SourcesView.tsx` 的 `.source-panel__table-wrapper`；它在卡片模式下被 `--admin-table-*` 规则接管。不要再新增 `.table-wrapper`，新后台数据表格一律走 `AdminDataPanel`。

### Pagination (Pagination)

- **Single Source:** 全站后台分页只有一个实现（`components/admin/Pagination.tsx`），默认是「数据面板页脚」形态：左计数、右控件（每页条数 → 翻页 → 第 X / Y 页 → 跳转），共享分页 token。需要把表格与页码控件分开时，使用 `variant="detached"`：分页作为 `AdminDataPanel` 的同级元素，形成透明、无边框、无圆角的独立控制行，只靠页面区块间距与内容对齐表达层级。
- **Detached Geometry:** 分页控制行的关键控件统一使用 `--admin-pagination-control-size: 2rem`：每页条数下拉触发器、翻页图标按钮和外置分页的页码输入框共用同一高度。页码输入框使用 `--admin-pagination-jump-width` 固定宽度，取消水平内边距，并让数字在控件内部水平居中；不要在调用点重新写高度、宽度或对齐魔法值。
- **Novels Footer Rhythm:** 小说管理的 `variant="detached"` 分页与表格相邻但不套卡片；分页控制行通过 `margin-top: calc(-1 * var(--admin-space-2))` 抵消默认区块间距的一档，使表格与分页保持连续的页脚节奏。该收紧只属于小说列表，不外溢到其他后台页面。
- **Default Page Size:** 默认每页 **15** 条，档位 **15 / 20 / 50 / 100**。两个常量 `ADMIN_DEFAULT_PAGE_SIZE` 与 `ADMIN_PAGE_SIZE_OPTIONS` 定义在 `lib/admin-pagination.ts`（独立模块，不是 `Pagination.tsx`——组件文件必须保持「只导出组件」，否则运行时常量导出会破坏 HMR 边界），是全站唯一来源——页面 `useState(ADMIN_DEFAULT_PAGE_SIZE)` 取初值并把 `ADMIN_PAGE_SIZE_OPTIONS` 传给 `pageSize.options`。**不要在页面里再写 `useState(50)` 或字面档位数组**：历史上小说 20 / 章节 50 / 审计 50 / 生成内容 50 / 书源 50 五处分叉，正是这么来的。
- **Presentation, Not API:** 15 是**展示层**默认值，后端各列表路由未传 limit 时仍回落到 50。这样未显式传参的调用方（含公开页）不会被静默截断。需要「一次拉全」的页面（抓取中心候选列表 `PAGE_SIZE=100`、审核队列 `limit: '80'`、章节索引 `limit: '2000'`）显式传自己的 limit，不消费本默认值。
- **Page-Size Change Resets Page:** 改变每页条数必须回到第 1 页（组件内部已回调 `onPage(1)`，调用方需把 offset 一并归零）；换筛选条件同理。留在原 offset 会落在越界区间，表现为「改完一片空白」。
- **Delete-Then-Empty Guard:** 当前页删到空且不在第 1 页时，回退一页而不是留在空页。
- **Front-stage Exception:** 前台 `Home` 保留自己的实现（内联原生控件 + `.home-pagination`），两套刻意分开：前台是阅读场景的卡片皮肤，后台是紧凑控制带。后台不得复用前台类名（曾因 home.css 的裸 `.home-pagination` 选择器把前台 20px 圆角漏进后台）。

### Panel Toolbar (AdminToolbar)

- **Ownership:** 工具条归属于它筛选的那份数据，而不是页面。筛选/搜索/批量操作只作用于某个 `AdminDataPanel` 的列表时，该 `AdminToolbar` 必须渲染在**那个面板内部**；有 `AdminPanelHeading` 时位于标题之下，没有标题时作为数据面板的第一段，始终在数据区（表格 / 列表 / 页脚）之上。
- **Anatomy:** 面板内工具条是面板的一段，不是独立表面。无自身圆角、无四边描边，只有一条 `--admin-border` 底线与数据区分隔；表面色用 `color-mix(in srgb, var(--admin-surface) 40%, transparent)` 与画布轻微区分。水平内边距与数据区（`.ai-list-body` / `.ai-tasks-content` 的 `1.25rem`，≤900px 降为 `1rem`）**必须同步**——只改一侧会让工具条与下方表格错开，出现两条左基线。
- **内间距归属：** `.admin-toolbar--inline` 自身**只有 flex 布局**（`display: flex` + `flex-wrap` + `gap`），不含内间距。每个工具条必须由**自己的 class** 补 `padding: 0.75rem 1.25rem` 与 `border-bottom: 1px solid var(--admin-border)`（范本见 `.ai-service .ai-tasks-toolbar`、`.chapter-toolbar`、`.moderation-toolbar`）。裸用 `<AdminToolbar>` 而不给 `className` 会得到零内边距：控件贴住面板左右边缘，且表头被压在筛选条下沿。
- **下边距必须外置：** `padding-bottom` 落在盒内，表格仍会紧贴 `border-bottom`（实测工具条 `bottom` 与 `thead top` 差 0px）。工具条与数据区之间需要 `margin-bottom: 1rem`，不能用 padding 代替。
- **Geometry:** `display: flex` + `flex-wrap: wrap` + `gap: 0.75rem`，靠换行适配窄屏而不另写断点；`min-height` 与纵向内边距按内容定档（AI 三面板 3.25rem / `0.75rem`，章节目录面板 3.75rem / `0.875rem`），不做强制统一。
- **Slots:** 组合顺序固定为「批量操作（仅在有选中项时出现）→ 字段标签 → 筛选控件 → 其余动作」；不要为筛选器新建一套卡片外观。
- **External Form:** 外置工具条（`AdminPage` 直接子级）是**例外**。跨多个面板生效或确实需要独立成卡时，才使用独立表面语言（`--radius-xl` 圆角 + 描边 + `--admin-panel` 表面色）；如果只是作用于一个数据集的轻量搜索/筛选组合，则使用透明的“列表控制行”，不能再创建等权卡片。
- **小说列表控制行:** 小说管理采用 `AdminPage` 页头 → `.novels-rating-toolbar` → `AdminDataPanel` 的结构。搜索框位于左侧并占据剩余空间，分级筛选胶囊位于右侧；控制行使用透明背景、无描边、无圆角，不再把筛选区伪装成第三张卡片。它位于表格面板之外，但表格面板仍从选择条、表格和分页开始。
- **References:** 章节管理的 `.chapter-toolbar` 与 AI 服务三个列表面板（AI 任务 / 已生成内容 / 调用审计）均已采用面板内形态。几何契约以本节为准：章节范本保留了历史的 `border-radius: 0.5rem 0.5rem 0 0`，实测在 40% 透明底色与 20px 面板圆角下不可见，属未收口的残留值，新面板不要复制。

**The Panel-Owned Toolbar Rule.** 默认情况下，一个筛选器不能与它所筛选的数据面板并列为两个等权表面。筛选条、标题、列表构成同一属主的三段（标题 → 筛选 → 数据）；若说明内容已经由相邻 `AdminContextPanel` 承担，筛选条仍必须留在 `AdminDataPanel` 内，作为数据面板的第一段。只有页面明确没有说明面板、且只保留一个轻量筛选条件，或需要让同一数据集的搜索与该筛选条件保持同一控制行时，才允许使用透明的外置列表控制行；它不得带卡片边框、背景或统计副文案。

### Admin Tab Header (AdminTabHeader)
- **Style:** 每个后台子页唯一的内容区页头，**单行账本式**：左侧标题独占标题行、描述位于其下，右侧该页的看家动作（搜索 + 主操作）。`flex-wrap` + `items-end`，间距 1rem，底部分隔线由各页变体关闭（小说、章节、审核、分级、内容安全、站点运营、AI 服务页无底线）。
- **Anatomy:** 只有一套。历史 `kicker` 眉题与 `hero` 变体已退役——标题上方不再出现小字，页面之间也不再有标题字号膨胀。
- **Title:** 共享字号 token `--admin-page-title-size`（20px）；保持 700 字重与 `letter-spacing: -0.04em`。
- **Title Line:** 标题后不附加规模摘要、状态小字或竖向分隔线；页名保持清楚、独立。
- **Counts and Status:** 放在所属面板标题栏、相关筛选器或分页区。异常信息放在对应页面内容中，避免把状态提示塞进页名行。
- **Actions 几何:** 桌面端 `width: fit-content` + `flex-wrap: nowrap`（左标题、右动作，中间留白）；900px 及以下 `width: 100%`，搜索框 `flex: 1 1 auto`、按钮 `flex: 0 0 auto`。搜索框自身定宽：小说管理 20rem，分级管理 18rem——**永不给 `flex: 1` 让它撑满页头**。
- **Ownership:** 页头由父容器通过 `AdminPage` 提供，`title` 传 `undefined` 时不渲染页头——供自带页头的子视图使用（`scrape/sources` 是唯一消费者）。子 tab 型页面（AI 服务、站点运营、账户与注册）的页头也由父容器统一提供，子面板不再自建页头。
- **动作归属:** 只有作用于**整页**的动作进页头。筛选某一份数据的下拉、批量操作、清除按钮归面板工具条（`AdminToolbar`），两者不重复同一个动作。

### Admin Metric Strip (AdminMetricStrip) — 停用
- **状态:** **全站无页面调用**（2026-09-25 起）。组件保留在 `AdminWorkspace.tsx` 供测试锚定三段结构，但新页面不得再引入。
- **禁止场景:** 一个指标条的数字若已在所属筛选器旁的计数说明、面板标题栏状态或页脚计数中呈现，就不再另起一块表面。概览读数应当**贴在能筛出它或汇总它的那块内容旁边**：
  - 分级账本 → 「待标注 67 · 限制级 340」贴着分级下拉；
  - AI 用量统计 → 「总调用 / 总成本 / 平均单次」贴着趋势图（`.ai-usage-totals`）；
  - 后台总览 → 库存 9 项收成一行紧凑读数（`.dashboard-stat-line`），不与任务状态争夺首屏。
- **测试锚点:** `admin-readability.test.tsx` 仍断言 `AdminMetricStrip` 的三段结构（label / value / detail 各自成元素）。

### Custom Combobox (CustomSelect)
- **Style:** 基于 Popover + Command (cmdk) 的搜索下拉
- **Trigger:** outline 按钮样式，右对齐 ChevronsUpDown 图标
- **Dropdown:** 白色背景，支持键盘导航和搜索过滤
- **Width:** 触发器基础宽度为 `w-full` + `max-w-[400px]`（表单内单列使用）。放入 flex 容器（尤其 `AdminToolbar`）时必须给出明确宽度，见下条。
- **`compact` 的语义是「更矮」，不是「解除宽度约束」：** `compact` 只改高度（`h-8`）并保留宽度上限 `max-w-[var(--admin-filter-width)]`（11rem）。调用方可用 `className` 覆盖该上限。
- **在 `AdminToolbar` 中的宽度契约：** 筛选器要么由 `CustomSelect` 自身的 `compact` 提供上限（11rem，适合「全部分级 / 全部来源」这类短选项），要么由外层容器用 `flex: 0 0 <宽度>` 固定（如 `.moderation-toolbar__status { flex: 0 0 9rem }`）。两者取其一即可，不必同时写。
- **`.admin-toolbar__filters` 是裸容器，没有任何 CSS 宽度规则：** 它不提供宽度约束，放在里面的 `compact` 下拉依赖 `compact` 自带的上限。

### Filter Chip (CustomSelect `filterChip`)

- **Purpose:** 用于与列表搜索并排的可选筛选条件，视觉上对应“状态 / 模型 / 可见性”一类的添加筛选控件；它不是普通表单下拉，也不是独立卡片。
- **Anatomy:** 前置 `CirclePlus` 图标 + 当前筛选文案 + 可点击触发器；隐藏普通下拉的 ChevronsUpDown，以加号图标表达“添加/打开筛选”。当前值仍由同一个 `CustomSelect` 下拉承载，不改变筛选行为。
- **Tokens:** 高度使用 `--admin-filter-chip-height`，最小宽度使用 `--admin-filter-chip-min-width`，圆角使用 `--admin-filter-chip-radius`，虚线边界使用 `--admin-filter-chip-border` / `--admin-filter-chip-border-style`，内间距、图标尺寸、文字字号与状态底色均使用同组 `--admin-filter-chip-*` token；禁止在调用点重新写魔法值。
- **Layout:** 当它与搜索框位于同一条 `AdminToolbar` 时，搜索框 `flex: 1 1 auto`，筛选胶囊 `flex: 0 0 auto` 并靠右；≤900px 搜索框独占第一行，筛选胶囊仍贴右对齐。
- **Accessibility:** 触发器保留 `role="combobox"`、`aria-expanded` 和可读的 `aria-label`；图标仅作装饰，不能替代控件名称。

**The Bounded-Compact Rule.** 紧凑控件可以更矮、更窄，但不能「无上限」。一个 `w-full` + `max-width: none` 的按钮放进 `flex-wrap` 容器，会独占一整行——单个筛选器撑满 1440px，三个控件把工具条撑成三行，视觉上从「筛选条」退化成「三个孤立的表单行」。**宽度上限必须由控件自身或容器显式给出，永远不要留给 flex 布局去决定。**

### Admin Filter Controls

- **Ownership:** 筛选控件的宽度归控件或它的直接容器，不归 flex 布局。
- **Source of truth:** 紧凑筛选器的默认宽度上限是 `--admin-filter-width`（11rem），定义在 `admin-operations.css` 的 `:root`。新增紧凑筛选器时优先复用该变量，不要就地写魔法数字。
- **Caller patterns（二选一）：** 短选项筛选器直接 `compact`（走 11rem）；需要更宽或更窄时，由外层容器 `flex: 0 0 <宽度>` 或 `className` 覆盖，并在调用点说明理由。
- **Verification:** 改动筛选器宽度后，实测该工具条的**子元素数量与换行数**（`AdminToolbar` 设计为同行排布，除非窄屏换行）；用 `getBoundingClientRect().width` 确认下拉不等于工具条宽度。

**`.admin-toolbar__filters`（标签 + 控件 + 计数说明的筛选器组）**

- 它按内容排列：`display: flex` + `flex: 0 0 max-content` + `flex-wrap: nowrap`，子项 `flex: 0 0 auto`；≤900px 才放开换行。
- **不要用 `width: max-content` + `max-width: 100%` 表达同一意图。** 百分比 `max-width` 在 flex 行里按已分配空间解析，与 `max-content` 形成循环依赖：浏览器按规范收敛到 286px，而子项里的 `CustomSelect` 触发器带 `w-full`，又按 `w-full` 长到 `max-w`（176px），最终子项共占 348px、溢出容器右界 62px。`flex-basis: max-content` 直接参与 flex 分配，绕开这一层耦合。
- 筛选条内的 `CustomSelect` 触发器必须 `width: auto`（选择器 `[data-slot='popover-trigger']`，注意不是 `data-slot='button'`）：否则 `w-full` 与父级 `max-content` 循环，元素宽度随容器收敛而非随内容。
- 该类名曾被当作「有类名、无规则」的占位容器使用，`display` 落到 `block`，标签、下拉、计数各自成块。它不是占位类，布局必须显式声明。


## Do's and Don'ts

### Do:
- **Do** 使用暖灰色调作为地面和背景，保持"纸面"质感
- **Do** 保持强调色的稀缺性——奶茶棕只出现在交互元素和品牌标记上
- **Do** 在管理后台使用 --admin-* 语义化间距和圆角变量
- **Do** 在阅读器场景使用衬线字体营造沉浸感
- **Do** 保持卡片和面板的扁平设计，仅在弹出层使用阴影
- **Do** 在暗色模式使用月光暖调（金色强调 + 深灰地面），不要简单反转
- **Do** 后台数据表统一走 `AdminDataPanel` + `columns` 契约，并手动标注 `data-primary` / `data-label` / `data-actions`
- **Do** 让每个页面只保留一个内容区主标题，面板标题写工作对象名
- **Do** 让后台卡片标题保持 16px、无分界线、无注释性副标题和前置 SVG 图标
- **Do** 让卡片标题行右侧只出现实时状态、所属数据读数或可执行控件
- **Do** 让页名独占标题行、描述位于其下方；标题后不接小字或竖线，搜索与整页动作留在右侧
- **Do** 把规模与状态读数放在所属面板、筛选器或分页区，不放在页名旁
- **Do** 把筛选读数贴在能筛出它的控件旁边（「待标注 67 · 限制级 340」紧邻分级下拉），而不是另起指标条
- **Do** 用 `data-slot` 属性匹配 shadcn 组件（`table.tsx` / `dialog.tsx` 都带契约），而不是依赖 Tailwind 生成的类名
- **Do** 给放进 flex 工具条的紧凑控件一个显式宽度（控件自身 `max-w-*` 或容器 `flex: 0 0 <宽度>`）；短选项筛选器直接用 `CustomSelect compact`

### Don't:
- **Don't** 使用纯黑（#000000）或纯白作为大面积背景——永远带暖调
- **Don't** 使用冷色蓝/紫/绿作为强调色——系统只有暖棕一个强调色
- **Don't** 给卡片或数据面板添加 hover 阴影效果——Flat-By-Default Rule 与 Tonal-Admin Rule
- **Don't** 在同一个信息块里堆叠超过 3 级字号——字阶本身是分档的（通用 / 后台紧凑 / 阅读表面），但单块内保持克制，不要为了"更醒目"临时插一档
- **Don't** 给后台加装饰性动效。状态反馈统一 150ms（`--admin-table-row-interaction`），面板进入 220ms（`--admin-table-surface-enter`），分段 tabs 位移 180ms——除此之外不加动效
- **Don't** 忽略 prefers-reduced-motion 媒体查询——尊重用户的动画偏好
- **Don't** 给数据面板套用 `columns` 之外的列宽方案，或手写 `--col-N-w`。列宽契约只有一个入口
- **Don't** 在页标题上方再加小字眉题，或用面板标题重复当前页面名
- **Don't** 在后台卡片标题下添加解释性副标题，或在标题前添加 SVG 图标
- **Don't** 在卡片标题行放静态快捷键提示、操作说明或装饰性标签
- **Don't** 在列表型后台页再插 `AdminMetricStrip`：它的数字若已在所属面板、筛选器或页脚计数里出现，就只是重复（见 The No-Third-Pass Rule）
- **Don't** 把同一个动作同时放进页头和面板工具条（见 The Single-Door Rule）
- **Don't** 让 `w-full` 的元素在 flex 容器里失去 `max-width`——`max-w-none` + `w-full` 会让筛选器独占整行，把工具条撑成多行
- **Don't** 依赖 flex 布局替控件决定宽度：`flex: 0 0 auto` 配合 `w-full` 的宽高组合在 `flex-wrap` 下没有稳定结果
