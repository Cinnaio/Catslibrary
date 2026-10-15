# Agent Instructions & Workspace Rules

## 1. 开发流程与能效准则 (Development & Verification Guidelines)
- **非必要不要运行验证测试，加快开发速度**：由于本地常驻运行了 Vite dev 开发服务器，业务与样式改动直接由用户在浏览器中热重载查看，非用户显式要求不要启动漫长的单元测试或端到端测试套件。
- **无需主动截图**：用户本地开着开发服务器，可以一眼看到页面渲染效果，非用户显式要求不必额外运行 Playwright 截屏脚本。

## 2. 界面设计规范 (UI & Motion Standards)
- 遵循 `DESIGN.md` 中定义的 Claude (Anthropic) 极简设计语言与单层控制流规范。
- 列表筛选、分页、搜索流转必须配备轻量、克制的阶梯式入场动效（Staggered Row Enter）与检索过渡态（Transitioning State）。
