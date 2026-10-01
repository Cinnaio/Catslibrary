# 分级管理独立 HTML 预览（2026-10-01）

本方案用于评估现行分级管理的布局与操作流程，继承知舟暖纸面和后台共享规范。Claude 风格体现在克制的留白、纸面层次和轻量导航；品牌强调色仍使用知舟奶茶棕。它是独立方案预览，尚未批准为全站设计系统变更。

## 打开与数据边界

直接用浏览器打开 [content-ratings-claude.html](previews/content-ratings-claude.html)，无需构建项目。页面包含深色主题切换、预览状态选择和“重置示例”，可重复检查布局与交互。

所有作品、数量、来源、证据、审计记录、规则命中、模型置信度和任务进度均为示例。操作只改变当前页面的内存状态，重新加载恢复初始示例；没有连接生产 API、数据库或真实模型任务。

## 三个工作视图

| 视图 | 工作对象与操作 |
| --- | --- |
| 分级账本 | 搜索作品，按分级与来源筛选，分页查看结果；人工修改附理由，查看分级历史，沉淀规则候选。 |
| 规则候选 | 查看候选类型、内容和理由，先预览命中作品及影响范围，再批准或拒绝。示例批准仅将命中的 `unknown` 作品改为 `restricted`。 |
| LLM 建议 | 模拟批量分析、查看处理进度、中止与断点恢复；逐条查看证据、元数据快照和作品版本，填写理由后审核。 |

分级口径沿用现行实现：R18 对应 `restricted`；`unknown` 表示未标注，不能视为 `general`。模型只提供 `restricted` / `unknown` 建议，必须人工确认；确认“继续未标注”保留 `unknown`，作品版本变化后的旧建议禁止批准。

## 共享规范映射

继承依据为 [DESIGN.md](../DESIGN.md)、[后台共用样式与组件](admin-style-system.md) 和 [本页方向契约](../.impeccable/surfaces/content-ratings-claude-preview.md)。独立 HTML 自带 CSS，通过下表映射共享角色；生产落地应复用既有组件与 token。

| 预览实现 | 共享角色或契约 |
| --- | --- |
| `--accent: #8b6045`、`--ink: #211e1a`、`--paper: #fff`、`--base: #f6f4f1`、`--line: #ece8e2` | 奶茶棕、暖墨、纸白、暖灰和内部细分隔，对应现有公共色板。 |
| `--canvas`、`--sidebar`、`--table`、`--thead`、`--soft` 的 `color-mix` | 对应 `--admin-canvas`、`--admin-sidebar`、`--admin-table-background`、`--admin-table-header-background`、`--admin-panel-muted` 的派生关系。 |
| 20px 页标题、16px 面板标题、系统无衬线字体 | 继承后台紧凑字阶和单一页面主标题；统计口径贴近筛选、所属列表和分页。 |
| 20px 数据面板圆角，无外描边、无静止阴影 | 对应 `AdminDataPanel` 和 `--admin-table-panel-radius`；以画布、纸面及内部行分隔表达层级。 |
| 常规控件40px，分页控件32px | 对应 `--admin-control-height` 与 `--admin-pagination-control-size`，分页不继承普通控件高度。 |
| 900px 及以下表格转卡片 | 继承共享响应式契约；窄屏分页第一行只放每页行数，第二行导航左、跳转右。预览在420px及以下隐藏首末页快捷按钮，并保持跳转文字不折行。 |

预览的弱化文字色、深色强调色和状态色使用局部值，移动分页420px补丁也是本页实现细节，均未提升为全站 token 或新规范。本次检查时，`git diff` / `git status` 未显示 `DESIGN.md`、`.impeccable/design.json`、`docs/admin-style-system.md`、生产 `web/src` 或 `api/src` 改动。

## 验证记录与交付图

本次主执行流程完成1440px、920px、390px和深色主题浏览器检查，覆盖搜索、分级/来源筛选、15/20条分页、人工修改及审计、保持 `unknown` 的建议审核、规则影响3本、旧建议禁用、中止恢复和错误重试。HTML 的 Prettier 检查与 `git diff --check` 通过。收尾复核确认此前390px分页折行问题已解决；该复核的 `ship` 结论仅覆盖此修复项。

首屏交付图：[桌面1440×1000](previews/content-ratings-claude-desktop.jpg)、[移动390×640裁切](previews/content-ratings-claude-mobile.jpg)。均来自本地预览的浏览器截图，没有生成图像资产。

完整验证截图位于 `.impeccable/review/content-ratings/`：`desktop.jpg`、`user-920.jpg`、`rules-desktop.jpg`、`ai-desktop.jpg`、`mobile.jpg`、`ai-mobile.jpg`、`review-mobile.jpg`、`dark-desktop.jpg`，覆盖账本、规则、LLM建议、审核弹窗和深色界面。

这些证据证明独立预览的相关布局与示例交互。生产验收仍需真实管理员会话与现行 API 联调，检查服务端分页/筛选、真实规则预览、审核写入及审计、作品版本冲突和任务中止恢复；本次没有完成这些验证。
