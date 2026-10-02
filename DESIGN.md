---
name: 知舟 (Zhi Zhou)
description: AI 中文小说阅读站 — 温暖纸质感的沉浸式书库
colors:
  primary: "#8B6045"
  primary-deep: "#74503A"
  primary-light: "#F0E6D6"
  primary-subtle: "#F8F3EC"
  surface: "#FFFFFF"
  toast-paper: "color-mix(in srgb, #FFFFFF 92%, #F8F3EC 8%)"
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
  home-title:
    fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', ui-serif, serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  home-title-mobile:
    fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', ui-serif, serif"
    fontSize: "1.55rem"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace"
  # 枚举字号阶（机器可读字阶）。命名语义见正文 Typography 一节。
  scale:
    label-sm: "0.7rem"        # 11.2px 导航分组标签/后台 kicker（紧凑档下限）
    table-head: "0.72rem"     # 11.52px 表头/指标条标签
    label: "0.75rem"          # 12px 计数胶囊/元信息
    caption: "0.78rem"        # 12.5px 发现卡作者/描述
    body-compact: "0.8rem"    # 12.8px 表单标签/分页/排序
    body-sm: "0.875rem"       # 14px 辅助文字/面板标题/页头描述
    select-trigger: "0.9rem"  # 14.4px 下拉触发
    card-title: "0.95rem"     # 15.2px 发现卡标题
    novel-card-title: "0.875rem" # 14px 公共小说卡片书名
    novel-card-meta: "0.75rem" # 12px 公共小说卡片作者/状态/简介
    novel-card-footer: "0.7rem" # 11.2px 公共小说卡片分类/时间
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
  novel-card-typography:
    titleSize: "0.875rem"
    metaSize: "0.75rem"
    descriptionSize: "0.75rem"
    footerSize: "0.7rem"
  home-library-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "24px"
  home-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    width: "620px"
    height: "60px"
  toast-feedback:
    backgroundColor: "{colors.toast-paper}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
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
**The Content-First Rule.** 字体永远是配角。系统字体不创造风格，内容本身创造风格。阅读器使用衬线体营造沉浸；2026-10-02 用户批准的首页、书架与个人中心也允许主标题使用现有 `--font-serif`，桌面 32px / 500 / 1.5、手机 1.55rem。例外限于 `Home`、`Bookshelf`、`Profile`，不扩展到后台或其他公共页；前言中的 `home-title` / `home-title-mobile` 记录这组共用尺寸，名称保持兼容。

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
- **首页例外（2026-10-02 用户追加调整）**: `Home` 使用最大 1200px 的暖灰纸面书库，桌面标题左、搜索右，hero 为 1:1.1 双列、间距 64px，1050px 以下间距 32px，700px 以下改为纵向居中。书目网格700px以上两列、700px以下单列；间距桌面16px、手机12px。手机容器内边距16px。首页不再展示最近阅读；完整表面策略见 `.impeccable/surfaces/web-src-pages-home-tsx.md`。
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

圆角策略温和而一致：公共按钮 6px（--radius-sm），单行输入框统一 12px（--input-radius），全局基础圆角 8px（--radius），紧凑控件与卡片 10px（--radius-md），管理后台控件与分段 tabs 药丸 12px（--admin-button-radius / --admin-input-radius / --radius-lg），嵌套表面与对话框 16px（--radius-xl / --admin-radius-dialog），后台大面板与 `.admin-panel-card` 20px（--radius-2xl）。分段 Tabs 另有明确的内外弧线契约：外框 12px、3px 内缩、激活表面 9px，统一由 `--tabs-segmented-*` token 提供。

- **公共控件圆角 (6px)**: 公共页按钮、输入框、标签、复选框——足够圆润但不接近圆形，像文具的倒角。
- **shadcn 控件圆角 (10px)**: shadcn/ui 基类（button/dialog）用 `rounded-md`，经 `shadcn.css` 的 `@theme inline` 桥接到 `--sh-radius`（即 `--radius-md` = 10px）。单行 Input 的最终圆角由全站 `--input-radius`（12px）覆盖。这里是 Tailwind 与站点 token 的接缝，也是唯一一处"工具类默认值不等于同名 CSS 变量"的地方——调整前台圆角时先看这里，不要改 Tailwind 工具类。
- **管理后台控件圆角 (12px)**: 后台的按钮、输入框、表单控件与 tabs 药丸统一 12px。作用范围是 `.admin-layout` 下的 `[data-slot='button']`、`[data-slot='input']`、`[data-slot='textarea']` 等，公开按钮不受影响；单行输入框外观由全站共享 input 规范统一。
- **卡片圆角 (10px)**: 紧凑卡片与旧版表格包裹器使用 `--radius-md`。
- **嵌套表面与对话框圆角 (16px)**: shadcn `Card`（`rounded-xl`）、对话框、嵌套表面。
- **后台大面板圆角 (20px)**: 数据面板（`--admin-table-panel-radius`）、`.admin-panel-card`——更明显的圆润感，像精装书的封面弧度。
- **公开页面结构归并**: 紧凑字段使用 `--radius-md`，控件使用 `--radius-lg`，操作下拉菜单遵循 `--menu-radius`（12px），内嵌卡片、浮层与对话框使用 `--radius-xl`，Hero 与大卡片使用 `--radius-2xl`；公开页面不再直接新增 11/13/14/15/17/18/22/24/26/28/30px 档位。
- **全圆角 (9999px)**: 胶囊标签、计数徽章、状态条——仅用于信息密度极高的辅助元素。
- **阅读页纸张圆角 (30px / 移动端 24px)**: `--reader-radius-paper`，唯一大于 2xl 的圆角。阅读表面要读起来像"一张纸"而不是一个卡片，弧度必须明显大过周围的控件；只用于 `.reader-paper`，其余阅读页元素仍走上面的通用档。

## Components

### Public Account Paper（书架与个人中心限定）

- **表面与导航:** `Bookshelf`、`Profile` 延续首页的暖纸世界，不增加色板。页面使用 `--bg-secondary`，卡片使用 `--bg-card`、`--radius-xl`（16px），无外描边、阴影、渐变或 hover 抬升。封面继续使用共享 `--novel-cover-shadow`，仅封面有深度。`.header--paper` 只用于 `/bookshelf`、`/profile`；首页继续使用 `.header--home`，保留既有账户、主题、安全模式、成人确认及手机导航行为。
- **布局:** 个人中心与书架共享最大1080px、区块间距24px的居中容器，主标题与纸面外分类导航沿同一左基线对齐。两页桌面上下内边距48px / 64px；600px及以下为28px / 40px、水平内边距16px。主标题使用上文限定的衬线字阶。个人中心为单一16px圆角设置纸面，桌面内边距32px、手机20px；身份摘要与当前设置内容均在纸面内，不设左侧摘要栏。书架同步区在800px及以下移至标题下。书架书目网格1000px以上三列、1000px及以下两列、600px及以下单列，间距16px。
- **书架（2026-10-02 修订）:** 用户否定先前四区纵向堆叠方案，改为收藏、最近阅读、书签、想法四个带计数的分类按钮，使用 `aria-pressed` 表达选择、一次只显示一个区域，其余区域 `hidden`，不使用 ARIA tabs 契约。按钮最小44px高，选中下划线与 hover 颜色复用 `--tabs-segmented-transition`，reduced motion 关闭过渡，键盘焦点使用2px暖棕外框、4px偏移。同步状态与按钮归页头。书目卡片统一18px内边距、最小高度152px、内容间距16px，封面固定72×108px、共享圆角与 `--novel-cover-shadow`，桌面/手机保持共享14 / 12 / 11.2px卡片字阶。书名最多两行，清除/取消收藏按钮位于卡片右下、与阅读链接分离，正文底部预留28px。书签与想法仍使用连续纸面记录、单条分隔线，14px标题与12px元数据可完整换行；四类空态使用透明背景。保持原有展示上限（收藏12、最近8、书签4、想法4）及API、同步、历史墓碑、删除、阅读跳转语义。修订类型检查与构建通过，fixture交互覆盖切换、同步、删除、链接及无横向溢出；截图使用模拟数据，不代表真实后端验证。本次14张截图最终复审结论为 ship（完成文档同步后），无需进一步修正或采图。
- **个人中心:** 页头下、纸面外使用个人资料、账户安全、登录设备三枚 `aria-pressed` 分类按钮，桌面间距28px、600px及以下20px，最小高度44px；隐藏非当前内容但保留挂载和编辑草稿。纸面顶部共用身份摘要，头像48px、手机40px，姓名16px / 600、用户名12px、角色/状态徽标11.2px；选中文件预览直接使用这枚头像，不另设头像预览或重复简介。身份区底部内边距与外间距各28px、手机各24px，以单条分隔线区分设置内容。个人资料中的头像操作在 DOM 中位于字段之前，不使用 CSS order；选择/删除按钮始终提供，上传按钮仅选中文件或上传中显示，隐藏文件输入 `tabIndex={-1}`。头像操作与资料/安全字段桌面采用160px标签列 + 弹性内容列、间距32px；标签13px，字段行间距24px，600px及以下单列、间距10px。注册与最近登录移至纸面底部11.2px脚注，管理员入口按既有角色显示；隐藏面板不创建独立卡片。
- **字段、设备与反馈:** 资料/密码沿用既有字段、可见性与提交行为；输入14px，600px及以下16px，移动按钮最小40px。设备列表最大高度300px、内部滚动，当前设备标记与注销限制保留，长设备名允许换行。`.profile-message` 放在页头描述之下的正常文档流中，空内容 `display:none`，13px / 1.8、12px上间距、`overflow-wrap:anywhere`；长失败信息不得覆盖标题或身份卡，保留 `role="status"` 和 polite 宣读。尊重 reduced motion，页面卡片与按钮关闭过渡。
- **边界:** 登录返回地址、API、收藏/书签/历史/想法同步、资料保存、密码、头像、会话及退出登录均接既有流程。规则限定 `.profile-page`、`.bookshelf-page` 与上述顶栏修饰类；表面契约见 `.impeccable/surfaces/web-src-pages-bookshelf-tsx.md` 与 `.impeccable/surfaces/web-src-pages-profile-tsx.md`，不修改独立首页 HTML 样稿。

### Home Library（首页限定）
- **方向:** 基于用户批准的 Claude 风格 HTML，并按 2026-10-02 用户追加反馈直接调整正式项目：暖灰 `--bg-secondary` 画布、奶茶棕强调色、白色 `--bg-card` 内容纸面；深色继续读取既有主题 token。品牌 Logo 与账户、主题、成人确认菜单沿用现有组件。独立预览 HTML 保持原样，当前布局以项目实现为准。
- **搜索:** 首页唯一搜索入口位于桌面 hero 右侧，手机标题下居中；桌面最大 620px、最小高度 60px，手机最小高度 56px。圆角与聚焦边框/光晕读取共享输入 token，标题与搜索尺寸使用 `--home-*` 命名变量。删除首页顶栏的重复搜索与手机搜索浮层，其他页面维持既有导航。
- **卡片:** 仅首页使用 `NovelCard` 的 `library` 变体，16px 圆角、无外描边、无静态或 hover 阴影；桌面两列、内边距24px、最小高度212px，手机单列、内边距18px、最小高度196px。封面保留真实图片，桌面 96×144px、手机 88×132px；仅无图片时使用占位纸面。书名允许两行，作者单独一行，状态标签与章节数并排；字号使用下述共享卡片字阶，简介最多三行、行高1.8；hover 只使用浅色调反馈。
- **安全提示:** 桌面为说明文字左、确认按钮右的轻量说明条；手机纵向排列，紧凑留白。调整仅涉及展示，安全模式与成人确认逻辑保持既有实现。
- **筛选与排序:** 状态/分类使用浅选中态；分类默认按固定优先序显示最多10个现有常用标签，其余通过“更多标签”在分类行下方轻量展开，按题材背景、情节氛围、关系属性及其他标签分组，无容器底色、外边框、阴影或浮层。桌面组名左、标签右，手机组名上、标签下，标签12px默认透明，仅悬停和选中显示浅色底；桌面32px、手机40px高，支持标签多选，点选添加、再点取消，选择后保持展开，多个标签按同时满足取交集，简繁别名在单个标签内取并集；单选兼容category参数，多选使用JSON字符串数组categories参数，分页/演示筛选同口径。已选条件常显且可取消/清除，手机收起整个筛选区时仍显示已选摘要。“校园/校園、现代/現代、青梅竹马/青梅竹馬、轻松/輕鬆”分别共用一个入口，服务端与演示数据均匹配两种历史写法，不修改存储标签；安全模式同样约束常用及展开标签。手机通过带展开状态的按钮收起/展开筛选；四种排序为轻量文字，选中项下划线与文字等宽对齐，使用独立指示线和 transform 在选项间滑动；复用共享 180ms 动效 token，快速点击可连续转向，键盘和减少动态效果模式即时切换。首页不再请求最近阅读进度；保留现有筛选、拼音搜索、安全模式及每页 20 条分页语义，历史记录继续由阅读器与书架维护。
- **实现边界:** 页面规则限定 `.home-page` 与首页顶栏修饰类，避免污染后台与其他卡片消费者。批准预览的演示登录、书架和数据交互不作为生产业务实现；正式页接现有 API 与路由。

### Novel Cover Depth（公共小说封面共享）

用户明确要求给书籍封面增加阴影，封面作为纸面上的书籍实体允许轻柔静态落影；容器仍遵守扁平卡片规范。共享 `.novel-card__cover` 读取 `--novel-cover-shadow`，浅色为 `0 2px 4px rgba(40, 32, 24, 0.08), 0 8px 18px rgba(40, 32, 24, 0.12)`，深色为 `0 2px 5px rgba(0, 0, 0, 0.24), 0 8px 20px rgba(0, 0, 0, 0.32)`。仅封面有阴影，卡片容器不增加投影或 hover 抬升；真实图片、占位封面、已读与更新角标沿用原实现。

### Novel Card Typography（公共小说卡片共享）

按用户提供的书目卡片样稿整体收紧字号，首页与书架的 `NovelCard` 共用 `tokens.css` 的字阶：书名 `--novel-card-title-size` 14px / 600，作者与状态 `--novel-card-meta-size` 12px，简介 `--novel-card-description-size` 12px，分类和更新时间 `--novel-card-footer-size` 11.2px。桌面与手机保持同一组字号，不在页面或断点另写字面量；页面只保留排版、行高和截断差异。此次只调整卡片内容字体，封面、圆角、内边距与布局不随字号缩放。

组件以 shadcn/ui 为基础，通过 CSS custom properties 桥接到知舟的暖色调系统。后台组件另有一套 workspace 原语（`components/admin/AdminWorkspace.tsx`）：`AdminToolbar`、`AdminSearch`、`AdminContextPanel`、`AdminMetricStrip`、`AdminQueueSummary`、`AdminDataPanel`、`AdminPanelHeading`。

### Buttons
- **Shape:** 公共页圆角 6px（--radius-sm）；管理后台圆角 12px（--admin-button-radius）。后台按钮最小高度 2.5rem（--admin-control-height），图标按钮不套用该高度。
- **Typography:** 后台常规按钮统一使用 500 字重（`--admin-button-label-weight`）；主要/危险操作字号为 14px，次要/描边及 Ghost/Link 为 13px。只有选中的分段 Tab 使用 600 字重。规则同时覆盖 `.admin-layout` 与 `.admin-dialog`；图标尺寸按钮和 combobox 不套用按钮字阶，`xs` 按钮保留组件字号。`.admin-layout` 内输入框与 SelectTrigger 为 14px；`.admin-dialog` 保留组件的响应字号（共享 Input 窄屏 16px、`md` 及以上 14px），不受按钮规则影响。
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
- **Label:** 标签统一使用 `--tabs-segmented-label-size`、`--tabs-segmented-label-weight`、`--tabs-segmented-active-label-weight`、`--tabs-segmented-label-line-height`（13px / 未选中 500 / 选中 600 / 1.6）；选中项通过字重差异强化当前选择，其他字阶保持一致。
- **Active Surface:** 激活表面 9px（`--tabs-segmented-inner-radius`），使用消费方的 surface 与 `--tabs-segmented-active-shadow`；未选中和选中文字分别使用 `--tabs-segmented-muted-foreground` / `--tabs-segmented-active-foreground`，选中文字重读取 `--tabs-segmented-active-label-weight`。
- **Motion:** 激活表面只用 `transform` 移动，不触发布局重排；时长、曲线和复合写法统一从 `--tabs-segmented-duration`、`--tabs-segmented-ease`、`--tabs-segmented-transition` 读取。默认是 180ms ease-out，必须在 `prefers-reduced-motion: reduce` 下将时长压到近乎 0。
- **Consumers:** 抓取入口、抓取预设、书源筛选、任务状态、审核类型、导入来源（含弹窗）以及其他后台分段 Tab 只覆盖消费方表面色值；几何、激活层、文字状态（含选中字重）和动效统一读取 `--tabs-segmented-*`，不再维护页面级圆角、内缩、间距和位移字面量。

### Cards
- **Corner Style:** shadcn `Card` 为 16px（`rounded-xl`）；说明面板使用 `--admin-context-panel-radius`（16px），后台数据面板使用 `--admin-data-panel-radius`（20px）
- **Background:** 白色/卡片色（var(--bg-card)），管理后台说明面板与数据面板分别使用 `--admin-context-panel-background` / `--admin-data-panel-background` 标准化
- **Shadow Strategy:** 静止无投影，hover 也不加（Flat-By-Default Rule + Tonal-Admin Rule）
- **Border:** 说明面板保留 `--admin-context-panel-border-width` 的 `--admin-context-panel-border` 描边；数据面板本身 `border: 0`，靠表面色分层，内部工具条/页头用 1px `--admin-border` 底线分区
- **Internal Padding:** 说明面板使用 `--admin-context-panel-padding`；数据面板工具条使用 `--admin-data-panel-toolbar-padding-block` × `--admin-data-panel-toolbar-padding-inline`，存在面板标题时仍使用 `1.5rem 1.5rem 1.25rem`

### Inputs / Fields
- **Style:** 全站单行 input 与多行 textarea 使用白色纸面、1px 细暖灰描边、12px 圆角和无静态阴影，参照「留空，由 AI 拟定」输入框样式。共享外观由 `styles/input-fields.css` 提供，读取 `--input-background`、`--input-border`、`--input-radius`；默认分别映射 `--bg-card`、`--border`、`--radius-lg`，深色随语义变量适配。覆盖共享 Input/Textarea、原生文本/数字/密码/搜索/日期输入、多行文本与弹窗表单，页面不再自行加深边框或添加静态阴影。
- **Focus:** 键盘聚焦使用 `--input-focus-border` 强调色边框及 `--input-focus-shadow` 2px 半透明光晕；`aria-invalid="true"` 使用危险色边框和聚焦光晕。不得用静态阴影替代焦点状态。
- **Geometry:** 后台常规控件继续使用 40px 高度，公共页保留原有布局尺寸和字体；搜索图标内缩、密码显示按钮及输入宽度由调用点保留。`.admin-input--compact` 为 34px，分页跳转框保留 32px 高度和居中零内边距；视觉外观统一，不统一扩大尺寸。复合 Command 搜索框将描边放在含图标的外层容器，内部 input 保持透明。
- **Multiline:** textarea 与单行输入共用白色纸面、细暖灰边框、12px 圆角和无静态阴影，聚焦与非法状态沿用共享输入 token；文本与占位字色沿用共享语义色。单行输入的固定高度规则不得作用于 textarea；保留各场景的最小高度、换行、行高、内边距与拖动调整大小。长提示词、章节正文、JSON 使用可伸缩的多行区域。

### Named Rules
**The Fit-Content Rule.** 输入框宽度随用途与提示信息而定，不设拉伸：短提示短框，长内容长框。避免 `flex-1` / `w-full` 把输入框撑满整行——工具栏里的过滤/搜索框用 `min-w` 限定下限、内容自然决定宽度，长 URL 输入才放宽。

**The Data-Panel Contract Rule.** 后台数据表一律走 `AdminDataPanel` + `columns`。`columns` 只做两件事：注入 `--col-N-w` 宽度变量、添加 `.admin-data-panel--grid`。它**不会**渲染单元格，也不会写 data 属性——调用方必须让「列定义顺序 = thead 顺序 = tbody 单元格顺序」三者一致，并手动标注 `data-primary` / `data-label` / `data-actions` / `data-check`。少写一个 `data-label`，那张卡片在 900px 以下就会缺一个字段标签；只传 `columns` 而不标属性，等于什么都没做。

### Shared Dropdown Menus

- **Shared Library:** 全站操作下拉菜单使用 `components/ui/dropdown-menu.tsx`，外观统一由 `styles/dropdown-menu.css` 和 `--menu-*` token 提供；后台行操作、用户管理与公开/后台账户菜单共用。不要在业务页重复定义菜单圆角、字号、内边距或行高。
- **Surface:** 浅色主题使用白色纸面，深色主题跟随 `--bg-card`；12px 圆角（`--menu-radius`）、1px 暖灰轻描边和 `--menu-shadow` 柔和阴影。默认最小宽度 176px，内部留白 4px；主菜单与嵌套子菜单一致，宽度受 Radix 可用空间和视口约束。
- **Items:** 默认文字 13px / 400（共享紧凑字阶）、行高 1.5，桌面每项至少 36px 高，左右内边距 12px，项目圆角 6px。保留足够留白，不要求普通操作添加图标；有图标时采用 16px，勾选/单选标记占独立左侧区域。标签保持次级层级，快捷键靠右。
- **States:** 悬停和键盘高亮使用淡暖灰背景，不改变普通文字颜色；禁用项降低透明度并不可选择。危险项显式传 `variant="destructive"`，文字与图标采用共享危险色，高亮只增加淡红底色。
- **Grouping:** 普通操作与删除等危险操作之间使用一条 1px 轻分割线，线条留在浮层内边距中，不贯穿外边框；分割线上下各 4px。
- **Interaction:** 保留 Radix 的 portal、方向键导航、Esc 关闭、焦点返回、复选/单选状态及视口碰撞避让。菜单通过 portal 渲染，禁止使用依赖表格祖先的选择器调整浮层。900px 及以下或触屏使用至少 44px 的操作高度，减少动态效果时关闭浮层动画。


### Shared Toast Feedback

- **Entry:** 全站反馈栏由 `components/ui/sonner.tsx` 和 `styles/toast-feedback.css` 统一呈现，业务页继续使用 `useToast().toast(message, type, options)`；不在页面复制局部外观。
- **Surface:** `--toast-background` 使用 92% 面板纸面与 8% 浅强调色派生暖白，文字使用 `--toast-foreground`；12px 圆角、无描边、`--toast-shadow` 轻量悬浮阴影。圆角、阴影、字号、内边距与间距集中使用 `--toast-*` token，随深色和自定义强调色映射。
- **Content:** 14px 常规字重、1.6 行高、14px × 16px 内边距、10px 图文间距；保留 16px 细线状态图标，成功/普通图标为品牌色，错误/警告图标分别为危险色/警告色，不能只依赖颜色区分状态。长文字自然换行，不截断。
- **Actions:** 撤销等动作采用浅强调色底与深强调色文字、6px 圆角、13px 字号，桌面最小 32px 高，手机及触屏最小 44px；保留清晰键盘焦点。禁止使用黑底操作按钮或整块高饱和状态背景。
- **Interaction:** 保留 Sonner 的底部居中、视口边距、堆叠、滑动关闭与可访问播报；普通提示自动消失，带操作默认保留 10 秒。减少动态效果时缩短过渡并停止加载图标旋转，业务行为与展示时长不变。

### Shared Account and List Primitives

用户目录预览中的搜索、计数、刷新、用户头像与身份/状态标签作为共享语言，页面只提供姓名、头像地址、数量和业务状态，不再复制局部外观。

| 元素 | 共享入口 | 尺寸与外观 |
| --- | --- | --- |
| 搜索 | `AdminSearch` / `components/toolbar.css` | 默认宽 280px，窄屏随容器收缩；高度沿用后台 40px，白底、细边、12px 圆角、无静态阴影，保留图标、可访问名称和聚焦提示 |
| 刷新等次要操作 | `Button variant="secondary"` | 暖灰底，无外描边和阴影；后台高度 40px、文字 13px，保留 hover、focus 与 disabled 状态；筛选 combobox 不使用此按钮外观 |
| 面板数量 | `.admin-panel-status` | 随文字自然宽度，暖灰胶囊，无描边；文字 12px、常规字重、等宽数字，数量需注明单位 |
| 用户头像 | `UserAvatar` / `identity.css` | 优先展示用户设置的图片，缺失或加载失败时由 `InitialAvatar` 显示姓名首字；默认 36px 圆形、等比裁切，文字回退为 13px 常规字重、浅奶茶底与品牌文字；`size="inherit"` 沿用所在入口的既有尺寸；只做装饰，姓名由相邻文字或控件标签提供 |
| 当前身份 | `Badge variant="identity"` | 11px 常规字重、6px 圆角、2px × 5px 内边距，浅奶茶底，用于“本人”等身份标记 |
| 角色与状态 | `AdminStatusBadge` | 11px 常规字重、3px × 8px 内边距、胶囊圆角、无描边；管理员使用 info/浅奶茶，普通角色 neutral/暖灰，正常 success/浅绿，禁用 danger/浅红；状态始终带文字，不能只依赖颜色 |

头像和标签几何使用 `web/src/styles/tokens.css` 中的 `--avatar-*`、`--badge-*`，面板计数使用 `--panel-count-label-size`。颜色均取现有主题 token，暗色模式不写死浅色值。其他业务状态继续使用已有 tone 合约；强调性的 brand 标签保留实色。

全站用户身份入口、用户目录、审计列表、密码目标、评论、段评、审核和个人资料统一使用 `UserAvatar`。图片和文字回退互斥，失败状态按图片地址保存，地址更新时可重新加载；禁止通过移除 DOM 或只隐藏失败图片造成空白头像。相对地址沿用 API 地址解析，本地上传预览保留 blob/data 图片地址。审计接口关联当前用户头像，账号不存在时保留记录并回退文字，不因头像缺失隐藏用户或记录。


### Proxy Settings
- **Hierarchy:** 代理设置采用「出站代理配置 → 路由与连通性」双面板。配置面板顶部集中展示当前生效地址或接口提供的代理主机、来源与跳过规则；编辑草稿不替换生效摘要。日志入口归页头，协议与部署说明使用面板外折叠区。
- **Settings Rows:** 桌面端标签与简短说明在左，输入与字段提示在右；640px 及以下改为纵向。面板、圆角、按钮、控件和字阶沿用共享 token，手机标题与状态保持同一行。
- **Feedback:** 保存反馈区分未保存修改、管理端配置生效和环境变量仍优先。读取失败不得显示为「未配置 / 直连」，重新读取成功后恢复配置与诊断操作。
- **Diagnostics:** 路由检查遵循生效配置，命中跳过规则的直连为中性结果；代理连接测试强制走代理。未启用时可检查路由，但不能测试代理连接；目标变更、配置保存或重新读取时清除旧诊断结果。

### Calls and Usage
- **Hierarchy:** 调用与用量保留「AI 调用 / 出站请求」子 tab。AI 调用按「统一时间范围 → 可折叠用量趋势 → 调用记录」组织；7 / 30 / 90 天同时作用于趋势和明细，类型筛选只属于调用记录面板，切换筛选或时间范围后回到第一页。
- **Trends:** 1181px 及以上，成本/次数与 Token 趋势并排、等宽、等高；更窄视口纵向排列。总调用、总成本、平均单次与总 Token 留在各自图表标题下的次级读数行，不新增独立指标卡。次数用淡品牌色柱形，成本用品牌色曲线，输入/输出 Token 使用共享成功色与信息色。
- **Records:** 类型筛选、计数、刷新和分页留在调用记录面板内；表格贴合无外描边的数据表面，只保留内部表头与行分隔。调用记录包含跨列展开详情，因此保留原生表格和面板内横向滚动，窄屏提供滑动提示，不套用普通表格卡片化；出站请求继续使用 `AdminDataPanel + columns` 的 900px 卡片化契约。
- **Cost:** 调用记录和用量趋势默认采用上游回传的账单成本，优先 `usage.cost`，兼容顶层 `cost`；文本、流式文本与图片共用解析规则。NewAPI 响应缺金额时，以 `x-oneapi-request-id` 精确关联同站只读账单，只有站点公开确认 USD 与 quota 单位时才换算，不使用 credit 或模型标价估算。明确的 0 是有效金额，未获取有效金额时标记 `costReported=false` 并显示「未回传」；查询失败不影响生成。API 金额单位不变，存储保留小数，界面显示四至八位小数，避免微小费用显示为 0；展开详情展示请求 ID、成本来源与币种。趋势标注金额回传覆盖次数，平均成本只以已回传金额的调用为分母；历史记录不自动重算。
- **Upstream Cache:** 调用记录在消耗列显示「缓存命中 N / 缓存未命中 / 缓存未回传」，展开详情显示缓存读取、写入与推理 Token。`null` 与 0 严格区分；趋势汇总只计算已回传字段并显示覆盖次数。缓存读取与写入属于输入 Token，推理属于输出 Token，不再次相加到总 Token；Claude 原生用量分拆字段需先归一为总输入。此处统计上游提示缓存，站内已有内容复用仍不新增上游用量。沿用共享字体、次级文字及现有面板，不增加独立指标卡。
- **Feedback:** 刷新入口属于对应的数据面板。初次读取失败使用共享读取失败空态，已有刷新入口的区域不重复放置重试；刷新失败但已有数据时保留数据并显示行内提示。读取失败或加载中不得将未知用量显示为 0。

### Model and Time

- **Shared Component:** 后台模型与时间组合使用 `AdminModelTime`（`components/admin/AdminModelTime.tsx`），共享样式位于 `admin/components/workspace.css`。上行模型名沿用确认样稿的 `Consolas, 'SF Mono', monospace` 字体栈，12px、字重 400、主文字色；下行使用 13px 次级文字色与等宽数字；两行间距 6px。
- **Date Format:** 日期与时间保持在同一行，复用 `formatDateTime`，按浏览器本地时区显示 `YYYY-MM-DD HH:mm`，不显示秒，不将日期与时间拆成两行。使用语义化 `time` 与 ISO `dateTime` 属性。缺失或无效数据显示破折号，长模型名省略并保留完整悬停提示。

### AI Service Workspaces

- **Scope:** AI 服务侧边栏保留 AI 创作、封面生成、已生成内容、AI 配置、参数调优五个子页。`AiTab` 统一提供页头与 URL 深链，任务中心和调用与用量继续使用各自入口。布局规则位于 `admin/pages/ai-service-claude.css`，限定在 `.ai-service`，沿用共享纸面、圆角、字阶、表单、状态、弹窗与分页原语。
- **Surface:** 暖纸面画布、无外描边白色面板、20px 面板圆角，面板之间 20px 留白。页标题 20px，面板标题 16px，段落标题 14px；控件与按钮继续使用共享尺寸。暗色通过语义变量映射，禁止页面硬编码浅色背景。配置供应商在桌面并排，卡片内部字段按标签在上、控件在下纵向排列，手机面板单列。
- **Writing:** 默认续写已有小说，单章精写优先。桌面主表单旁展示真实作品上下文与任务回执，窄屏顺序堆叠。内容尺度和三份小说分析放在创作要求之前；分析状态常显、正文按需展开。推荐情节、大纲、新写、多章规划、人工校正与 R18 参数保留现有业务语义。目标作品与标题、承接章节与目标字数各成两列；内容尺度使用灰色内嵌表面，小说分析收敛为三条紧凑行。本次情节标题右侧放推荐按钮，大纲默认折叠，多章模式展开必填规划。侧栏提供真实封面、作者、章节数、模型、本次输出、未发布草稿提醒、任务进度和最近任务。结果审阅后发布。
- **Cover:** 作品上下文、生成设置、候选比较分别组织。生成设置和候选区在宽屏并排，窄屏顺序排列；描述词在主表单常显，作品资料与 AI 理解按需折叠；候选以缩略图选择器配选中大图呈现，当前封面与历史独立成卡。真实图片等比呈现，保留大图查看、候选采纳与舍弃、上传替换及封面历史。生成只落候选，采纳或恢复才改变当前封面，保留版本并发检查。
- **Directory:** 已生成内容复用 `AdminDataPanel density="comfortable"`，搜索属于页头，类型、状态筛选属于目录工具条，桌面使用关联内容（含选择框）、类型与状态、内容预览、模型与时间、操作五列，分页使用面板外 `Pagination variant="detached"`。搜索作品、章节与正文时由服务端过滤，列表和总数使用相同条件，输入 `%`、`_` 等字符按原文匹配。筛选或每页数量变化返回第一页；过期请求不覆盖新结果。分页以目录项计数：一个续写合集算一项，其他独立内容各算一项。服务端先按筛选条件合并续写批次再分页，同一合集的匹配章节不跨页；目录总数、页数及显示范围均使用该单位，展开章节不占每页名额。批量选择与删除仍按实际生成记录计数。删除导致当前页超出范围时回到最后一个有效页。合集的内容预览优先展示续写时选定的原始情节，不使用完整模型提示词或生成正文冒充；新产物保存情节快照，旧产物按精确任务关联恢复，缺少来源时回退到章节数量。
- **Configuration:** 精细对齐 `docs/previews/ai-service-claude.html#config`：文本、图像供应商独立白色表面，桌面等宽双列、20px 间距、24px 内边距，标题旁显示带圆点的语义状态，标题下以 12px 说明用途。字段纵向排列，字段组间距 20px、标签与控件间距 6px；使用共享纸面输入框，页面采用 40px 高度，模型字段不重复附加说明。连接操作置于细分割线下。读者策略与服务检查使用通栏面板，策略说明与双列额度字段在桌面左右排列，窄屏顺序堆叠；用量使用自然换行的行内摘要，呈现今日调用、Token、成本和近 30 天调用及成本。底部保存栏使用 16px 圆角、12px 纵向内边距、距视口底部 16px。已配置不等于连通性验证成功；图像服务使用真实封面生成入口，不提供无后端支持的演示测试按钮。编辑只更新本地草稿，底部统一保存配置和撤销修改；保存前校验所有分组，按文本、图像、读者策略顺序提交有改动的分组。部分失败时提示已完成分组并保留失败草稿，重试不重复提交已成功分组，不在输入数字时自动写入。未改动的有效值刷新不清除其他分组草稿。密钥占位符和聚焦后的空输入不下发，明确填空格才按既有约定清空密钥。连通性测试基于已保存的文本供应商。
- **Parameters:** 以 `docs/previews/ai-parameters-claude.html#params` 为参数调优样稿。六个参数组采用顶部分类标签和单个通栏面板，取消内部左侧导航；桌面标签自然排成一行，手机排成两行，字段单列堆叠。分类切换保留各组草稿，修改分类显示圆点，底部展示所有分类的待保存字段数；支持方向键与 Home/End 切换分类，标签与面板通过 ARIA 关联。所有面板保持挂载，保存时校验全部分类的数字字段，遇到隐藏分类的无效值先切换到该分类并聚焦字段，不允许跳过隐藏字段校验。AI 创作按基础生成和分析与辅助生成分层。Temperature 使用 0–1、步进 0.1 的滑块并显示当前值，开关使用简洁说明行，长提示词默认折叠。底部保存栏保持可见，显示未保存状态，支持撤销与保存全部参数。保存前校验输入范围，加载或保存期间禁用提交。页面滚动由外层文档承担，避免内层 `overflow: auto` 截断 sticky 区域；底部留白必须容纳保存栏。

### Read Failure States
- **Shared Surface:** 后台列表或面板首次读取失败使用 `ErrorState`，复用 `AdminEmptyState` 的居中结构，以抓取任务为范本：32px 淡化的禁止图标、次级色的加粗原因文字、至少 14rem 的内容区。避免紧凑红字错误块与相邻子 tab 形成不同的空态层级。
- **Message:** 文案采用「对象加载失败：具体原因」。例如「AI 任务加载失败：需要管理员登录」。任务摘要同时显示读取失败标题与真实原因，不能继续显示正常操作介绍，也不能将失败呈现为「暂无记录」。
- **Recovery:** 已有页头或面板刷新入口时，错误区不重复添加重试按钮；没有刷新入口的面板保留 `onRetry`。读取重试只重新获取数据，必须与任务的重新执行或重新生成区分。
- **Partial Data:** 刷新失败且已有数据时继续展示旧内容，以 `InlineError` 提示失败。首屏读取失败、真实空列表、未配置供应商和任务本身执行失败使用各自的状态，不相互替代。表单校验、行内任务错误与完整管理员访问门禁不使用此空态替换。

### Navigation (Sidebar)
- **Style:** shadcn 可折叠侧边栏（`collapsible="icon"`, `variant="floating"`），展开态 16rem、图标态 3rem、移动端抽屉 18rem。桌面侧栏使用 `--admin-sidebar` 独立纸面，保留轻微外部留白和 `--radius-xl` 圆角，不使用外描边或阴影；不要把它改成边到边的 `sidebar` 变体。导航溢出时保留滚动能力，但隐藏滚动条视觉轨道。
- **Brand / Account:** 侧栏顶部品牌容器是返回首页的入口；账户菜单固定在侧栏底部，承载个人中心与退出登录。账户区域与上方导航之间使用 `--admin-sidebar-footer-fade-height`（24px）的轻量纸面淡出，不添加硬分隔线或模糊滤镜。仅在下方仍有可滚动导航时显示；无溢出或滚到底时撤掉遮罩。导航末端保留等高余量，确保最后一个菜单完整可见。滚动、窗口尺寸与子菜单展开变化均更新边缘状态；遮罩不接收指针事件。桌面侧栏与手机抽屉沿用同一规则。
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

### Pagination (Pagination)

- **Single Source:** 全站后台分页只有一个实现（`components/admin/Pagination.tsx`），默认是「数据面板页脚」形态：左计数、右控件（每页条数 → 翻页 → 第 X / Y 页 → 跳转），共享分页 token。需要把表格与页码控件分开时，使用 `variant="detached"`：分页作为 `AdminDataPanel` 的同级元素，形成透明、无边框、无圆角的独立控制行，只靠页面区块间距与内容对齐表达层级。
- **Shared Geometry:** `panel` 与 `detached` 分页的关键控件统一使用 `--admin-pagination-control-size: 2rem`（32px）：每页条数下拉触发器、文字或图标翻页按钮、页码输入框共用同一高度与最小高度，不继承后台普通控件的 40px 高度。宽度按用途保留：下拉使用 `--admin-pagination-page-size-width`，图标按钮为正方形，文字按钮随文案，页码输入框使用 `--admin-pagination-jump-width` 固定宽度、取消水平内边距并居中数字。尺寸由共享 `components/pagination.css` 提供；不要在调用点或页面 CSS 重新写高度、宽度或对齐魔法值。验收时同时检查两种变体、明暗主题和窄屏布局。
- **Novels Footer Rhythm:** 小说管理的 `variant="detached"` 分页与表格相邻但不套卡片；分页控制行通过 `margin-top: calc(-1 * var(--admin-space-2))` 抵消默认区块间距的一档，使表格与分页保持连续的页脚节奏。该收紧只属于小说列表，不外溢到其他后台页面。
- **Default Page Size:** 默认每页 **15** 条，档位 **15 / 20 / 50 / 100**。两个常量 `ADMIN_DEFAULT_PAGE_SIZE` 与 `ADMIN_PAGE_SIZE_OPTIONS` 定义在 `lib/admin-pagination.ts`（独立模块，不是 `Pagination.tsx`——组件文件必须保持「只导出组件」，否则运行时常量导出会破坏 HMR 边界），是全站唯一来源——页面 `useState(ADMIN_DEFAULT_PAGE_SIZE)` 取初值并把 `ADMIN_PAGE_SIZE_OPTIONS` 传给 `pageSize.options`。**不要在页面里再写 `useState(50)` 或字面档位数组**：历史上小说 20 / 章节 50 / 审计 50 / 生成内容 50 四处分叉，正是这么来的。
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

后台样式的维护入口为 `web/src/styles/admin-operations.css` 的导入清单：后台语义变量集中在 `web/src/styles/admin/tokens.css`，共用外观在 `admin/components/`，业务布局在 `admin/pages/`，框架在 `admin/shell.css`。字段、状态与弹窗分别使用 `AdminFormField`、`AdminStatusBadge` / `AdminContentRatingBadge`、`AdminDialogContent`，具体归属与用法见 [后台共用样式与组件](docs/admin-style-system.md)。保留现有视觉与响应式契约，不在入口末尾继续堆叠覆盖规则。

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

### Directory Row Density and Dates

用户目录的注册时间使用本地日期 `YYYY-MM-DD`（共享 `formatDate`），以 `<time>` 标记并通过 title 提供完整本地日期时间；无值显示“—”。登录时间继续使用相对时间，无登录记录显示原有占位文案。

共享 `AdminDataPanel` 提供 `density="compact" | "comfortable"`，默认 compact。用户目录采用 comfortable：桌面单元格上下 16px、左右 20px 内边距，目标行高 76px，内容较多时允许自然撑高；表头左右内边距与内容对齐。移动端保持连续卡片及单条分隔线，上下 16px 内边距、字段间距 8px，不施加桌面固定行高。字体、头像、控件尺寸不随行密度放大。

几何参数统一放在 `web/src/styles/admin/tokens.css` 的 `--admin-table-comfortable-*`，由 `components/tables.css` 消费。其他表格按业务信息密度选择此变体，页面不复制行高或单元格内边距规则。

### Registration and Audit Views

账户与注册的四个入口继续使用现有 URL 与侧栏子导航，不另加桌面页面内 tab。注册、登录审计与操作审计沿用共享搜索、白色无外描边面板、comfortable 列表密度、状态标签、具体日期与三段式详情弹窗。

- 注册方式以三张单选项表达，区分当前生效方式与未保存草稿；保存中禁用编辑与重复提交，失败保留草稿。邀请码目录集中数量与生成按钮，支持全量邀请码集合的搜索、状态筛选和分页（接口不再截断为最近 100 个码）；生成数量遵循现有接口的 1–50 限制。停用先确认，清理仍按确认快照处理所有失效码，不受当前搜索或分页影响。
- 登录目录使用用户、结果与原因、访问来源、时间、操作五列；IP 与设备摘要组合，完整 User-Agent、原因、记录 ID 保留在只读详情。未知设备不推断具体平台，未知原因保留原值。限流采用 warning 状态。
- 操作目录使用操作人、动作与范围、结果、操作标识、时间、操作六列；动作与目标数量组合，操作 ID 与 HTTP 状态组合。详情保留完整 ID、重放次数、错误以及创建/更新/完成时间，不展示请求哈希、密码或目标正文。用户名搜索必须由服务端完成，并保证总数与分页使用同一筛选条件。
- 审计筛选与行数变化回到第一页，搜索保留 400ms 防抖；旧请求不得覆盖新筛选结果。外置分页沿用共享控件，不调整通用控件高度。移动端继续使用连续记录卡片，长字段在详情中完整换行显示。
