# AI 服务 Claude 风格落地

按已确认的 `docs/previews/ai-service-claude.html` 方向更新项目中的五个 AI 服务子页，使用真实业务数据与已有 API，不把 HTML 示例数据接入应用。

## 页面与共享规范

- AI 创作：主表单与作品上下文、任务回执并列。单章续写默认，保留新写、多章、内容尺度、小说分析、推荐情节、大纲、任务取消与批次草稿跳转。
- 封面生成：生成设置与候选比较分栏，描述词常显，作品资料按需展开，候选缩略图与选中大图配合独立当前封面/历史卡片；保留实际图片、候选、大图、上传替换、历史恢复与版本检查。
- 已生成内容：共享宽松五列目录、页头搜索、目录内类型及状态筛选、真实目录刷新、批次展开、审阅与批量操作。分页移到面板之外。显示记录总数与本页展示项数，批次归组不冒充记录总数。
- AI 配置：文本和图像供应商独立表面，读者策略与服务检查分组。底部统一显式保存及撤销，先校验所有输入，再顺序提交有变化的分组；部分失败提示已完成组，保留剩余草稿供重试。未修改的有效值刷新不清空其他分组草稿，密钥占位符和聚焦后的空字符串不下发。图像配置状态取实际生效供应商，兼容部署环境中的配置。
- 参数调优：六组连续面板、桌面侧边导航、手机横向导航，长提示词默认折叠。保存栏在视口底部保持可见，支持脏状态、撤销、输入校验与提交期间禁用。

共享组件沿用 `AdminPage`、`AdminPanelHeading`、`AdminFormField`、`AdminDataPanel`、`AdminSearch`、`Pagination` 和现有 UI 原语。新增布局模块 `web/src/styles/admin/pages/ai-service-claude.css` 只作用于 AI 服务；清理旧参数账本布局，避免覆盖新表单。`DESIGN.md` 已新增 AI Service Workspaces 规范。

## 搜索契约

前端搜索输入防抖 350ms，变化后返回第一页；请求序号阻止过期响应覆盖新结果。`GET /api/ai/generations` 新增可选 `q`，保持已有 scope/status/kind 默认行为。服务端按作品、章节和正文进行不区分大小写的字面匹配，关键词限制 100 字符，查询参数化。总数与列表使用相同条件，按时间与 ID 稳定排序，排除软删除记录。

## 验证

- `npm run typecheck`：web、api 均通过。
- 前端 AI 子目录 7 个测试文件：70 项通过，覆盖续写参数和异步隔离、策略显式保存、0 配额、非法输入、失败保留、撤销、密钥占位符保护、跨组草稿保留、配置部分失败重试与参数校验。
- 后端 `routes/ai.test.ts` 与 `services/ai/generations.test.ts`：84 项通过，覆盖既有创作/发布/封面流程以及新增搜索、分页、总数、字面字符、注入字符串、状态与软删除过滤。使用独立 PGlite 测试库和上游响应桩。
- `npm run build`：web 与 api 均通过。Vite 仍提示部分产物超过 500 kB。
- 相关 TSX 与新增测试 ESLint：0 error，11 条 `react-hooks/set-state-in-effect` warning，属于保留的 effect 同步模式。
- 真实登录会话检查五个子页；实际目录搜索空结果和刷新正常，参数导航与折叠可用。390 × 844 下五页无整页横向溢出，深色参数页检查通过，完成后恢复跟随系统主题和正常视口。
- 现场视觉验收只读取实际业务数据，不启动收费生成、不发布草稿、不采纳/恢复封面、不保存真实供应商密钥或业务配置。写入流程通过隔离测试验证。

## 实际效果

- [创作桌面](previews/ai-service-writing-project-desktop.png) / [创作手机](previews/ai-service-writing-project-mobile.png)
- [封面桌面](previews/ai-service-cover-project-desktop.png) / [封面手机](previews/ai-service-cover-project-mobile.png)
- [目录桌面](previews/ai-service-content-project-desktop.png) / [目录手机](previews/ai-service-content-project-mobile.png)
- [配置桌面](previews/ai-service-config-project-desktop.png) / [配置手机](previews/ai-service-config-project-mobile.png)
- [参数桌面](previews/ai-service-params-project-desktop.png) / [参数手机](previews/ai-service-params-project-mobile.png) / [深色手机](previews/ai-service-params-project-dark-mobile.png)

本版作为 AI 服务改版的阶段基线，与代码、设计规范、HTML 样稿和实际页面截图一同提交。

## 样稿一致性修正

针对首版与样稿结构差距，重新排列主表单与侧栏，压缩三项小说分析，内容尺度使用灰色内嵌表面，推荐入口紧邻情节标题。目标作品与标题、承接起点与字数分别并排。封面描述词常显，配置提供统一保存栏，参数温度改为滑块，生成内容合并为五列。样稿中的演示内容替换为真实作品、配置、任务和产出数据；当前作品没有候选时显示实际空态，尚未对已填充候选画廊做现场视觉验证。

本次已重新检查桌面五页、390×844 手机五页和深色手机参数页，并更新截图。手机视口检查使用临时 CDP 设备尺寸，因为浏览器通用视口覆盖未生效；检查结束已清除设备覆盖、恢复正常视口及跟随系统主题。没有启动收费生成、保存现场配置或改变封面。
