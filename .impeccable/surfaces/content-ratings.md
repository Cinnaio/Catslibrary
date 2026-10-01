# 分级管理项目落地

Primary target: `web/src/pages/admin/ContentRatingsTab.tsx`

Mode: Operate。用户在评估独立 HTML 预览后要求「先落实到项目看一下效果」。沿用已选预览方向，扩展知舟既有后台世界；这次批准覆盖本页落地，不代表批准替换全站设计系统。

继承依据：[PRODUCT.md](../../PRODUCT.md)、[DESIGN.md](../../DESIGN.md)、[设计扩展](../design.json)、[后台共享契约](../../docs/admin-style-system.md)。四份文件保持原样。历史预览记录保留在 [预览方向](content-ratings-claude-preview.md) 和 [预览说明](../../docs/content-ratings-claude-preview-2026-10-01.md)。

## Direction contract

THESIS: 三个可导航工作视图替代纵向长页。账本承载已发生的分级事实与追溯，规则承载候选及影响预览，LLM 承载模型建议与人工审核。

OWN-WORLD: 继承奶茶棕、暖灰画布、系统字体、20px 页标题、16px 面板标题和低饱和状态标签。主面板使用白色纸面、20px 圆角、无外描边与阴影，依靠背景差和内部细分隔表达层次；分段导航使用既有 Tabs。

STORY: 管理员定位作品、查看证据、填写理由、确认决定。`unknown` 不等于 `general`；R18 对应 `restricted`；模型只建议 `restricted` / `unknown`，经人工审核才修改分级。只有人工标记为限制级的记录可沉淀规则候选。

FIRST VIEWPORT: 既有后台侧栏与页头下依次放三段导航、可展开分级口径和当前工作面板。搜索只在账本显示，刷新作用于当前视图，规模读数贴近筛选和对应队列，不新增独立指标卡。

FORM: code-led 的操作型分段工作台。复用 `AdminDataPanel`、`Pagination`、`AdminDialogContent` / `AdminDialogBody`；账本通过 `columns` 和单元格 `data-*` 属性继承900px卡片化。`view=ledger|rules|ai` 保存视图，切换时保留其余查询参数。

FINISH: 独立复核发现的两个移动 LLM 布局问题已修复；收尾复核对这两项给出 `ship`。完整验证与边界见 [项目落地记录](../../docs/content-ratings-implementation-2026-10-01.md)。没有生成图像资产；交付截图来自本地项目浏览器。

## Local responsive contract

- 900px及以下：账本表格转卡片，队列动作换行；分页第一行只放每页条数，第二行导航在左、跳转在右。
- 420px及以下：隐藏分页首末页快捷按钮，保留上一页、下一页和跳转；三段导航占满可用宽度。
- 639px及以下：LLM标题区待审核数量先成一行，再排列批量控制组；任务进度说明在恢复操作上方，不挤成窄列。
- 局部样式位于 `web/src/styles/admin/pages/content-ratings.css`，由 `admin-operations.css` 导入；不把本页断点或导航处理升级成新全站规范。

## Canon comparison

实现复用共享颜色、控件尺寸、数据面板圆角、分页和弹窗结构。白色无描边主面板符合 DESIGN.md 当前 Components / Cards 的数据面板条目。既有规范仍有漂移：DESIGN.md 的 Tonal-Admin Rule 还泛称面板使用1px描边，Stat Value 段仍描述已停用指标条；设计侧车的页头、数据面板标题和侧栏样例也保留旧形态。本次记录这些差异，未修订全局 canon；后续不要据这些旧样例回退本页。
