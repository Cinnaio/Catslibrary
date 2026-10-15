# Agent Instructions & Workspace Rules

## 1. 开发流程与能效准则 (Development & Verification Guidelines)
- **非必要不要运行验证测试，加快开发速度**：由于本地常驻运行了 Vite dev 开发服务器，业务与样式改动直接由用户在浏览器中热重载查看，非用户显式要求不要启动漫长的单元测试或端到端测试套件。
- **无需主动截图**：用户本地开着开发服务器，可以一眼看到页面渲染效果，非用户显式要求不必额外运行 Playwright 截屏脚本。

## 2. 界面设计规范 (UI & Motion Standards)
- 遵循 `DESIGN.md` 中定义的 Claude (Anthropic) 极简设计语言与单层控制流规范。
- 列表筛选、分页、搜索流转必须配备轻量、克制的阶梯式入场动效（Staggered Row Enter）与检索过渡态（Transitioning State）。

## 3. Git 提交信息规范 (Commit Message Conventions)
所有 Git 提交必须遵循结构化 Conventional Commits 并在 Body 中提供详实的点状阐述清单：
- **Header 结构**：`<type>(<scope>): <核心改动中文概要>`
  - `<type>`：`feat` / `fix` / `style` / `refactor` / `perf` / `chore`
  - `<scope>`：精确到模块，如 `admin-content-ratings`, `admin-novels`, `catalog-toolbars`, `reader` 等
- **Body 结构（空行隔开，使用 `- ` 清单列表）**：
  - **动机与降噪**：说明消除了何种视觉冗余或交互冲突（例：*彻底移除列表内部多余的宏观分级光谱通栏，消灭 80px 内数字连续重复的视觉堆砌感*）；
  - **组件与架构**：说明具体控件、样式框架与数据流的收敛动作（例：*将大盘分级光谱精炼为 AdminPanelHeading 标题右侧的微型状态胶囊与 60px 极细比例条*）；
  - **体验与呼吸感**：说明页面空间、层级或呼吸感的提升（例：*释放近 50px 宝贵的垂直空间，首屏呈现更多书籍条目，大幅提升工作流呼吸感*）；
  - **契约与可用性**：确认业务逻辑完整性与无障碍支持（例：*保持全部业务交互契约与 ARIA 属性完整*）。

**标准范例：**
```gitcommit
style(admin-content-ratings): 采纳方案A微缩光谱至账本标题右侧，彻底移除列表内冗余横条

- 彻底移除列表内部多余的宏观分级光谱通栏，消灭80px内数字连续重复的视觉堆砌感
- 将大盘分级光谱精炼为 AdminPanelHeading 标题右侧的微型状态胶囊与 60px 极细比例条
- 让作品分级账本面板回归纯粹的 Claude 纸白作业台，直通筛选工具栏与数据行
- 释放近 50px 宝贵的垂直空间，首屏呈现更多书籍条目，大幅提升工作流呼吸感
- 保持全部业务交互契约与 ARIA 属性完整
```
