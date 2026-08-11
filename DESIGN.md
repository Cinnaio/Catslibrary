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
    label-sm: "0.7rem"        # 11.2px 导航标签/kicker/侧栏分组
    table-head: "0.72rem"     # 11.52px 表头
    label: "0.75rem"          # 12px 计数胶囊/元信息
    caption: "0.78rem"        # 12.5px 发现卡作者/描述
    body-compact: "0.8rem"    # 12.8px 表单标签/分页/排序
    source-toolbar: "0.82rem" # 13.1px 书源工具栏
    body-sm: "0.875rem"       # 14px 辅助文字/页标题
    select-trigger: "0.9rem"  # 14.4px 下拉触发
    card-title: "0.95rem"     # 15.2px 发现卡标题
    body: "1rem"              # 16px 正文/品牌标记
    modal-title: "1.15rem"    # 18.4px 弹窗标题
    title-min: "1.25rem"      # 20px section-title clamp 下限
    hero-min: "1.45rem"       # 23.2px hero 标题 clamp 下限
    title-max: "1.6rem"       # 25.6px section-title clamp 上限
    stat: "1.75rem"           # 28px Dashboard 统计数字
    hero-max: "1.9rem"        # 30.4px hero 标题 clamp 上限
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
  sm: "6px"
  md: "8px"
  md-admin: "10px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
  full: "9999px"
  reader-paper: "30px"      # 阅读页纸张表面，移动端 24px；见 --reader-radius-paper
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

**Key Characteristics:**
- 奶茶色暖调贯穿，拒绝冷色和高饱和度
- 纸质感地面（接近白色的暖灰），文字如墨迹
- 阴影极简，依赖色调层次而非投影创造深度
- 系统字体 + 衬线字体用于阅读场景
- 组件触感温暖，圆角适度，像精心制作的文具

## Colors

暖调奶茶色板，以唯一的棕色强调色（#8B6045）锚定视觉重心，大面积中性暖灰提供呼吸空间。

### Primary
- **Milk-Tea Brown** (#8B6045): 强调色，用于链接、按钮、活跃状态、品牌标记。像精装书封面上的烫金字——稀有而有分量。
- **Espresso Ink** (#211E1A): 正文主色，接近深棕黑。用于标题和正文，不是纯黑而是带暖调的墨色。

### Neutral
- **Clean Paper** (#FFFFFF): 最浅的纸面，用于卡片和弹层背景。
- **Warm Linen** (#F6F4F1): 微暖的灰白，用于页面地面和次级背景。
- **Hover Tint** (#F5F2EE): 悬停态背景，比 Warm Linen 再暖一度。
- **Faded Parchment** (#9A938A): 弱化文字，用于辅助信息、时间戳、占位符。
- **Warm Gray-Brown** (#5B554E): 次要文字，用于非强调的说明文字。
- **Border Mist** (#ECE8E2): 边框和分隔线，极淡的暖灰。
- **Deep Border** (color-mix 84%): 管理后台更强的边框线。

### Semantic
- **Reading Green** (#4F7A52): 成功状态。柔和的书页绿，不刺眼。
- **Amber Warning** (#B07C2F): 警告。旧纸般的琥珀色。
- **Vermilion Danger** (#BE123C): 危险操作。传统朱砂红。
- **Collector's Seal** (#b8453a): 收藏印章色，用于"已收录"标记。

### Dark Theme
暗色模式不是反转，而是"月光下的书房"：深灰地面（#1B1C20）替代白色纸面，金色强调色（#BF8F52）替代棕色，文字变为暖白（#E7E0D6）。所有语义色相应提亮。

### Named Rules
**The 10% Accent Rule.** 奶茶棕色强调色在任何页面上不超过 10% 的面积。它的稀有性就是力量——读者的眼睛自然被引导到最重要的交互点。

## Typography

**Display/Body Font:** System sans-serif stack (-apple-system, PingFang SC, Microsoft YaHei)
**Serif Font:** Noto Serif SC / Source Han Serif SC (阅读器场景)
**Mono Font:** SF Mono / Fira Code / Consolas

**Character:** 系统字体带来原生、安静的感觉——不抢注意力，让内容本身成为视觉主角。衬线字体在阅读器中营造纸质书的氛围。

### Hierarchy
- **Display** (700, clamp(1.25rem, 1rem + 0.5vw, 1.6rem), 1.15): 页面标题（section-title），沉稳而不张扬。
- **Stat Value** (600, 1.75rem, 1.1): Dashboard 统计数字，与 12px 标签形成清晰的尺寸断裂——全后台唯一的"大数字"层级。
- **Headline** (700, 2rem, 1.3): h1，用于页面级标题，letter-spacing: -0.02em。
- **Title** (600, 1.3rem, 1.3): h2，段落标题。
- **Body** (400, 16px, 1.6): 正文。行高 1.6 提供舒适的阅读节奏。
- **Label** (750, 0.65rem, 0.1em uppercase): 分类标签（detail-kicker），极小但醒目，用于元数据和分类标签。
- **Compact Label Scale (Admin)** (400-750, 0.7-0.8rem): 管理后台专属的紧凑密度字号阶梯，用于 OPERATE 模式的高信息密度扫描。包括：导航标签 (0.7rem)、kicker (0.7rem)、表头 (0.72rem uppercase + 0.07em)、计数胶囊 (0.75rem)、元信息 (0.75rem)、分页 (0.8rem)。这一档刻意低于公开阅读界面的字号——管理控制台优先扫描效率，阅读界面优先舒适度。**对比度不可妥协**：弱化文字须满足 AA ≥4.5:1，数据读取面（表头/内容）字号 ≥11px。
- **Reading Surface Scale (Reader)** (`reader.css`，与上一档相反的方向): 阅读页有自己的一档字号，全部高于通用档。正文 1.1rem/行高 2.05（移动端降到 1rem/1.85），章节标题 clamp(1.55rem, 3vw, 2.15rem)、移动端定值 1.35rem，纸张右上角的「读」字水印 clamp(3rem, 8vw, 6rem)、移动端 3.2rem。**这一档只在 `.reader-app` 内生效**，不得外溢到公共页或后台；反过来，阅读器内也不使用后台的紧凑档。

### Named Rules
**The Content-First Rule.** 字体永远是配角。系统字体不创造风格，内容本身创造风格。唯一例外是阅读器中的衬线体——那是为沉浸而存在的。

## Layout

内容驱动的流式布局，最大宽度 1200px（--max-width-content），阅读器收窄到 680px（--max-width-reader）。

- **公共页面**: 居中容器，20px 内边距，纵向流动。小说网格使用 auto-fill + minmax(330px, 1fr)，间距 36px × 44px。
- **管理后台**: 左侧 236px 可折叠侧边栏 + 右侧内容区。内容区使用 1440px 最大宽度，内部 padding 1.25rem（桌面）/ 1rem（移动）。
- **响应式断点**: 900px（侧边栏折叠、网格单列）、640px（紧凑间距、表格横向滚动）、400px（按钮全宽）。
- **间距节奏**: 4/8/16/24/32/48px（xs → 2xl），管理后台使用 --admin-space-1 到 --admin-space-6 语义化间距。

## Elevation & Depth

阴影极其克制——这个系统依赖色调层次（tonal layering）而非投影来创造深度。阴影仅在两个场景出现：弹出层（modal/popover）和管理后台的全局阴影。

### Shadow Vocabulary
- **Rest** (`0 1px 2px rgba(40,32,24,0.04), 0 1px 3px rgba(40,32,24,0.05)`): 卡片和按钮的静态投影，几乎不可见——像纸页微微浮起。
- **Elevated** (`0 6px 16px rgba(40,32,24,0.08)`): 悬停态和次要弹层。
- **Modal** (`0 24px 70px rgba(40,32,24,0.18)`): 模态对话框，最重的阴影但仍保持暖调。
- **Admin Ambient** (`0 18px 48px rgba(40,32,24,0.10)`): 管理后台卡片和面板。

### Named Rules
**The Flat-By-Default Rule.** 所有表面在静止状态是平的。阴影仅作为状态响应出现（hover、elevation、focus），或为弹出层提供层次暗示。

## Shapes

圆角策略温和而一致：公共控件 6px（--radius-sm），shadcn 控件 8px（--radius），管理后台控件 12px（--admin-button-radius / --admin-input-radius，与 tabs 药丸的 rounded-lg 对齐），卡片 10px（--radius-md），面板 16px（--radius-xl），对话框 12px（--radius-lg）。

- **公共控件圆角 (6px)**: 公共页按钮、输入框、标签、复选框——足够圆润但不接近圆形，像文具的倒角。
- **shadcn 控件圆角 (8px)**: shadcn/ui 组件（button/input/dialog 基类）默认 8px。
- **管理后台控件圆角 (12px)**: 管理后台的按钮与输入框统一 12px，与 tabs 药丸（rounded-lg）并排时圆弧一致。
- **卡片圆角 (10px)**: 内容卡片、表格包裹器——微妙的弧度，不抢注意力。
- **面板圆角 (16px)**: 管理后台大面板、统计卡片——更明显的圆润感，像精装书的封面弧度。
- **全圆角 (9999px)**: 胶囊标签、计数徽章、状态条——仅用于信息密度极高的辅助元素。
- **阅读页纸张圆角 (30px / 移动端 24px)**: `--reader-radius-paper`，唯一大于 2xl 的圆角。阅读表面要读起来像"一张纸"而不是一个卡片，弧度必须明显大过周围的控件；只用于 `.reader-paper`，其余阅读页元素仍走上面的通用档。

## Components

组件以 shadcn/ui 为基础，通过 CSS custom properties 桥接到知舟的暖色调系统。所有组件继承 --admin-radius / --admin-radius-sm 的圆角规范。

### Buttons
- **Shape:** 公共页圆角 6px（--radius-sm），管理后台圆角 12px（--admin-button-radius），高度 2.25rem（--admin-control-height）
- **Primary:** 奶茶棕背景（#8B6045）+ 白色文字，用于主要操作（保存、确认）
- **Secondary:** 暖灰背景（#F6F4F1）+ 深色文字，用于次要操作（刷新、取消）
- **Ghost:** 透明背景 + 次要文字色，用于图标按钮（表格行操作）
- **Destructive:** 危险红背景 + 白色文字，用于删除操作
- **Hover / Focus:** 背景色加深一档，focus 显示 4px 暖色光晕（rgba(139,96,69,0.24)）

### Cards
- **Corner Style:** 圆角 10px（--admin-radius）
- **Background:** 白色/卡片色（var(--bg-card)），管理后台面板使用 admin-panel 标准化
- **Shadow Strategy:** 静止无投影，hover 不变（Flat-By-Default Rule）
- **Border:** 1px solid var(--admin-border)，暖灰色边框线
- **Internal Padding:** 24px（--admin-space-5）

### Inputs / Fields
- **Style:** 1px 边框（var(--border)），白色背景，公共页圆角 6px、管理后台圆角 12px（--admin-input-radius），高度 2.25rem
- **Focus:** 2px 暖棕色轮廓 + 4px 光晕，不改变边框颜色
- **Compact Variant:** 高度 2rem，用于工具栏紧凑场景

### Named Rules
**The Fit-Content Rule.** 输入框宽度随用途与提示信息而定，不设拉伸：短提示短框，长内容长框。避免 `flex-1` / `w-full` 把输入框撑满整行——工具栏里的过滤/搜索框用 `min-w` 限定下限、内容自然决定宽度，长 URL 输入才放宽。

### Navigation (Sidebar)
- **Style:** 可折叠侧边栏，展开态 236px 宽，图标态 48px
- **Active State:** 左侧 2px 暖棕色竖线指示器（inset box-shadow）
- **Typography:** 菜单项 0.875rem，分组标签 0.65rem uppercase + 0.1em 字距

### Table
- **Style:** 包裹在 1px 边框容器中，圆角 10px，背景 admin-panel
- **Header:** 粘性定位，暖灰背景（admin-panel-muted），0.68rem uppercase 标签
- **Row:** 高度 3.25rem，hover 时微弱 primary/5% 背景色
- **Sortable Headers:** 内联按钮样式，活跃态显示暖棕色

### Admin Tab Header (AdminTabHeader)
- **Style:** flex 布局，标题 + 操作栏底部分隔线，间距 1rem
- **Kicker:** 0.65rem uppercase + 0.1em 字距，暖灰色——用于分类标签
- **Title:** clamp(1.25rem ~ 1.6rem) 自适应，700 字重

### Custom Combobox (CustomSelect)
- **Style:** 基于 Popover + Command (cmdk) 的搜索下拉
- **Trigger:** outline 按钮样式，右对齐 ChevronsUpDown 图标
- **Dropdown:** 白色背景，支持键盘导航和搜索过滤

## Do's and Don'ts

### Do:
- **Do** 使用暖灰色调作为地面和背景，保持"纸面"质感
- **Do** 保持强调色的稀缺性——奶茶棕只出现在交互元素和品牌标记上
- **Do** 在管理后台使用 --admin-* 语义化间距和圆角变量
- **Do** 在阅读器场景使用衬线字体营造沉浸感
- **Do** 保持卡片和面板的扁平设计，仅在弹出层使用阴影
- **Do** 在暗色模式使用月光暖调（金色强调 + 深灰地面），不要简单反转

### Don't:
- **Don't** 使用纯黑（#000000）或纯白作为大面积背景——永远带暖调
- **Don't** 使用冷色蓝/紫/绿作为强调色——系统只有暖棕一个强调色
- **Don't** 给卡片添加 hover 阴影效果——Flat-By-Default Rule
- **Don't** 使用超过 3 种字号层级——保持排版的克制和统一
- **Don't** 在管理后台使用花哨的动画——仅使用 160ms ease-out 的微妙过渡
- **Don't** 忽略 prefers-reduced-motion 媒体查询——尊重用户的动画偏好
