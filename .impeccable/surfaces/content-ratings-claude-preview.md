# 分级管理 HTML 预览

Primary target: `docs/previews/content-ratings-claude.html`
Mode: Operate. 供管理员评估分级账本、规则审核、LLM 审核的布局与交互；所有数据为示例。
范围仅为独立 HTML 预览。继承 DESIGN.md、docs/admin-style-system.md 和已有 Claude 风格预览的暖纸面、20px 页标题、20px 无描边面板、900px 表格卡片断点、32px 分页契约。生产 React、API 和全局规范不修改。

## Direction contract

THESIS: 三个工作视图替代纵向长页；账本负责结果与追溯，规则负责影响预览，LLM 负责逐条人工复核。分级事实、建议、审核动作明确归属。

OWN-WORLD: 知舟奶茶棕、暖灰画布、白色纸面；公共色板派生表面，轻量分段导航、低饱和状态标签、细内部行分隔，不以统计卡片制造层级。

STORY: 先定位待标注作品，再查看证据或审核建议；修改必须附理由。unknown 不等于 general；模型只提出 restricted / unknown 建议；规则批准前显示影响范围。

FIRST VIEWPORT: 左侧 224px 知舟导航，右侧 20px 页面名与说明、搜索和刷新；下方三段导航，然后白色数据面板。筛选在面板内，账本六列，作品和证据是主要阅读内容。侧边规则口径用可展开说明承载。

FORM: 已明确风格下的操作型分段工作台，code-led。Seed key: brief-pinned-claude-shared-admin。关键交互为同一视觉外壳中的证据预览、填写理由、确认审核。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

设计规范仅作为继承依据，不将预览方案写成已批准的全站规范。截图为浏览器验证证据，无生成图像资产。
