# 分级管理项目落地（2026-10-01）

用户评估 [独立 HTML 预览](content-ratings-claude-preview-2026-10-01.md) 后要求「先落实到项目看一下效果」。本次把该方向落实到真实 React 管理页面，继承知舟已有后台样式和业务接口。历史预览文档继续描述示例页面；本记录描述项目实现与实际浏览器证据。

## 实现与工作视图

页面入口为 [ContentRatingsTab.tsx](../web/src/pages/admin/ContentRatingsTab.tsx)，局部布局位于 [content-ratings.css](../web/src/styles/admin/pages/content-ratings.css)，由 [admin-operations.css](../web/src/styles/admin-operations.css) 导入。方向契约见 [content-ratings.md](../.impeccable/surfaces/content-ratings.md)。

| 视图 | 实际行为 |
| --- | --- |
| 分级账本 `view=ledger` | 页头显示搜索，面板内筛选分级与来源；保留服务端分页、人工修改附理由、分级历史与规则候选入口。 |
| 规则候选 `view=rules` | 展示候选和待审核数量，保留影响预览及批准/拒绝流程。 |
| LLM 建议 `view=ai` | 展示待审核建议、批量分析、任务进度和恢复入口，保留证据、元数据快照及人工审核流程。 |

切换视图只修改 URL 的 `view`，保留其他查询参数；浏览器刷新及前进后退可恢复视图。搜索仅出现在账本，页头刷新按钮按当前视图同步对应数据。共享 Tabs、`AdminDataPanel`、`Pagination` 与 `AdminDialogBody` 提供导航、表格、分页与弹窗外壳。

既有 API、revision 校验、人工理由、审计记录和任务恢复逻辑继续使用。`unknown` 表示未标注，不能当作 `general`；R18 对应 `restricted`。只有人工限制级记录可生成规则候选；模型仅提供 `restricted` / `unknown` 建议，必须人工审核。保留作品版本变化后的冲突防护。

## 视觉与共享规范对照

本页采用暖灰画布、奶茶棕强调色、白色20px圆角主面板，无外描边和静止阴影；内部筛选、表格与队列用细分隔组织。页标题20px、面板标题16px，普通控件与分页继续走共享尺寸，分页控件32px。这里的白色纸面读取 `--bg-card`，主题颜色继续由既有变量控制。

继承 [PRODUCT.md](../PRODUCT.md) 的中文运营场景和管理效率原则，沿用 [DESIGN.md](../DESIGN.md)、[design.json](../.impeccable/design.json) 和 [后台共享契约](admin-style-system.md)。四份文件均保持原样，本次授权未扩展为全站设计系统重写。

| 对照点 | 判断 |
| --- | --- |
| 主面板、页头、表格 | 复用共享组件与 token；20px无描边数据面板符合 DESIGN.md 当前 Cards / Containers 条目。 |
| 响应式 | 900px及以下表格转卡片；分页每页条数单独一行，导航左、跳转右。420px及以下隐藏首末页快捷按钮。 |
| LLM窄屏 | 639px及以下，待审核数量与批量控制组分行；进度说明在恢复操作上方。属于本页局部布局。 |
| 既有文字漂移 | DESIGN.md 的 Tonal-Admin Rule 仍泛称面板1px描边，而 Components 已说明数据面板 `border: 0`；Stat Value 段仍描述指标条，但其他条目明确停用。 |
| 既有侧车漂移 | design.json 中 Admin Tab Header 样例仍有标题后计数、底线与放大标题；数据面板样例标题为20px；侧栏样例保留旧浅色选中与竖线。当前共享实现与 DESIGN.md 较新条目已采用紧凑页头、16px面板标题及整行品牌色导航。 |

这些既有差异只作记录，没有顺手修订全局文件，也没有以旧样例替换当前共享组件。

## 验证与交付证据

项目测试18项、类型检查和生产构建通过；移动修复后的类型检查与生产构建再次通过。检测器结果为 `[]`。构建仍提示既有 chunk 体积警告。

真实项目浏览器检查覆盖1440×1000、920×668和390×844。验证到的账本总量为408本，未标注筛选67本；第二页显示16–30条。规则待审核为0，LLM待审核为51；已取消批次显示11/27，剩余缺口16。这些是本次会话观察值，不是固定产品数据。

独立复核最初要求修复两个移动 LLM 问题：标题区数量挤入控制组，以及任务恢复按钮压窄进度说明。局部CSS修复后，收尾复核对这两项给出 `ship`，桌面LLM截图未观察到回归。该结论限定于上述修复项；账本、规则与弹窗已在先前复核中检查。

| 截图 | 用途 |
| --- | --- |
| [桌面账本](../.impeccable/review/content-ratings-project/desktop.png) | 1440×1000整体布局。 |
| [920px账本](../.impeccable/review/content-ratings-project/user-920.png) | 920×668桌面列宽与页头。 |
| [移动账本](../.impeccable/review/content-ratings-project/mobile.png) | 390×844首屏卡片字段与证据分组；分页排列另经浏览器 DOM 检查。 |
| [移动规则](../.impeccable/review/content-ratings-project/rules-mobile.png) | 规则空队列与视图结构。 |
| [桌面LLM](../.impeccable/review/content-ratings-project/ai-desktop.png) | 建议队列和任务恢复状态。 |
| [移动LLM](../.impeccable/review/content-ratings-project/ai-mobile.png) | 修复后的标题控制组与进度排列。 |
| [移动修改弹窗](../.impeccable/review/content-ratings-project/edit-mobile.png) | 分级与理由字段、操作区。 |
| [桌面审核弹窗](../.impeccable/review/content-ratings-project/review-desktop.png) | 建议证据与人工审核结构。 |

截图来自本地项目浏览器，没有生成或交付新的位图资产。本次未实际提交 API 保存、规则/LLM审核、批量扫描或恢复任务，因而不把浏览器布局证据视为写入、服务端任务执行和审计落库验收。此次证据覆盖页面读取、导航、筛选、分页和弹窗呈现；真实写入及任务动作仍需单独验证。
