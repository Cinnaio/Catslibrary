---
version: 1
slug: "web-src-pages-reader-tsx"
primary_target: "web/src/pages/Reader.tsx"
related_targets: ["web/src/styles/reader.css", "web/src/styles/mobile.css", "web/src/components/reader/MobileSheets.tsx", "web/src/hooks/useReaderSettings.ts"]
---

# Reader 章节阅读器 · 表面契约

## THESIS

2026-10-02 用户批准正式项目中的暖纸阅读改版。阅读内容占据主层；工具栏与导航保持易用且安静，阅读偏好继续由用户已有设置控制。

## OWN-WORLD

沿用 `--bg-secondary` 画布与既有 default / eye / paper 主题、对应暗色语义色，不增设色板。正文纸面16px圆角、平面填色，无外描边、静态投影、装饰渐变或「读」字水印。设置、目录、手机弹层仍以现有浮层阴影表达层次。

## STORY

顶部书名链接返回小说详情；原有上章/目录/下章、主题与设置入口继续存在。纸面承载章节标题、原有前情提要及正文；下方保留章节导航与阅读进度。手机通过独立、全宽且不透明的底部控制区展开或收起工具栏，目录/书签与设置弹层保持原语义；首页与回到顶部移到正文后方的普通流页尾，避免悬浮按钮覆盖正文。不替换阅读和分页手势。

## FIRST VIEWPORT

桌面工具栏保持 sticky、原生暖灰填色与单条细底线，不使用玻璃、圆角卡片或投影。章节标题28px / 500 / 1.5、居中、字距-0.02em，距正文32px；手机1.35rem，间距28px。正文 CSS 基线1.1rem / 2.05，手机1rem / 1.85；实际字形、字号与行距受持久化阅读设置覆盖，不能将这组 CSS 默认值当作用户设置的替代。

## FORM

- 阅读宽度继续使用既有 narrow 620px、standard 680px、wide 780px。根容器桌面内边距20px / 20px / 48px，纸面44px / 40px内边距、16px圆角。
- 640px及以下根容器16px / 14px，底部为手机工具栏及 safe area 留出原有空间；纸面28px / 20px内边距，圆角仍16px。顶部按现有手机布局变为静态导航。
- eye 保留浅绿纸面与墨绿正文，paper 保留浅黄纸面与暖褐正文；暗色继续使用既有派生色。主题改变的是阅读色板，纸面形态保持一致。
- 移动设置/目录 Dialog portal 接受可选 `container`，页面提供 `readerAppRef.current`，使浮层继承阅读主题与遮罩 token；保留 CSS 回退、modal、关闭和焦点恢复语义。
- 桌面和手机阅读进度即时更新宽度，取消宽度过渡。不新增动效；已有弹层及加载反馈继续遵守减少动态效果处理。

## BEHAVIOR

保留字号六档、字体、行距、段距、页宽、主题、分页、点击翻页、自动滚动和保持亮屏等原设置与持久化。保留章节加载/预取、进度、书签、想法、上下导航、目录搜索、虚拟列表与手机手势，书名链接指向当前作品详情。

## VERIFICATION

主代理已报告类型检查、构建与22项相关测试通过，移动 portal 焦点/ref 回归另有2项通过。演示 API 回退验证页面行为，不证明真实后端进度、书签或想法写入。桌面1280/1440、手机320/390与深色主题截图记录在 `.impeccable/review/reading-redesign`；最终 `final-confirmation.md` 对手机阅读控制区和详情内边距两项修正给出 ship。最终代码类型检查与生产构建通过，仅保留既有构建体积提示。
