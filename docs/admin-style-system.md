# 后台共用样式与组件

后台沿用现有暖纸面视觉。页面提供数据、业务文案与操作，共用组件提供外观、结构和响应式契约。

## 样式入口与归属

`web/src/styles/global.css` 仍通过 `admin-operations.css` 加载后台样式。`admin-operations.css` 只作为导入清单，不再追加页面样式或补丁。本次拆分保持原规则的相对顺序，既有未分层规则仍优先于 Tailwind utilities；不要给其中一部分单独加 `@layer`。

| 需要调整的内容 | 修改位置 |
| --- | --- |
| 后台颜色、字号、间距、圆角、控件尺寸、表格密度、动效和弹窗尺寸 | `web/src/styles/admin/tokens.css` |
| 侧栏、顶栏和后台框架 | `web/src/styles/admin/shell.css` |
| 页头、面板、工具栏、搜索、筛选、分页、表格、状态、字段、弹窗与异步反馈 | `web/src/styles/admin/components/` 中对应模块 |
| AI 工作流、抓取配置、章节融合、账户等业务专属布局 | `web/src/styles/admin/pages/` 中对应模块 |
| 全站基础色板、字体、公共圆角和公共分段控件 | `web/src/styles/tokens.css` |

例如，改表格密度先改 `--admin-table-row-height`；改所有字段间距先改 `--admin-field-gap`；改弹窗先查 `components/dialogs.css` 和 `components/dialog-variants.css`。页面样式只补业务布局，不再重复声明共用面板的底色、圆角、标题或状态颜色。

`_admin.css`、`_admin-ui.css` 中仍兼容原有编辑器和公共旧控件，加载顺序保留在原位置。这些文件的公共选择器也可能影响前台；新后台代码使用下列共用组件，删除旧规则前需查清消费者。

## 页面、数据和操作

沿用已有 `AdminPage`、`AdminPanelHeading`、`AdminToolbar`、`AdminSearch`、`AdminDataPanel`、`AdminSelectionBar`、`AdminRowActions`、`AdminEmptyState`、`AsyncStates` 与 `Pagination`。

- 页头提供页面名、说明和整页动作。筛选条件属于工具栏。
- 数据表面使用 `AdminDataPanel`。`columns` 只配置列宽；真实单元格仍需 `data-label`、`data-primary`、`data-actions`。
- 表格在 900px 及以下按已有契约转为卡片。含跨列展开的审计表可保留横向滚动。
- `Pagination` 的 `panel` 与 `detached` 变体共用翻页和页大小行为，不另写一套页脚。
- 两种分页变体的每页条数选择器、翻页按钮和页码输入框统一使用 `--admin-pagination-control-size`（32px）的高度与最小高度，由 `components/pagination.css` 提供，不能继承后台普通控件的 40px 高度。宽度按用途保留：条数选择器使用 `--admin-pagination-page-size-width`，图标按钮为正方形，文字按钮随文案，页码输入框使用 `--admin-pagination-jump-width` 并居中数字。新增列表需复用这些规则，验收时检查普通与外置分页、明暗主题和窄屏。
- 批量操作和行内操作沿用共用组件；业务负责危险操作确认与请求处理。
- `AdminMetricStrip` 保持已有停用约定，不在新页面重新引入。

## 字段

`AdminFormField` 统一标签、控件与辅助说明的间距。简单控件沿用既有 ID 和事件处理器：

```tsx
<AdminFormField label="模型" htmlFor="provider-model" hint="填入供应商支持的模型名称">
  <Input id="provider-model" value={model} onChange={onModelChange} />
</AdminFormField>
```

复合控件可使用 render prop，自动得到独立的控件 ID 和标签 ID：

```tsx
<AdminFormField label="来源">
  {({ labelId }) => (
    <CustomSelect aria-labelledby={labelId} options={options} value={source} onChange={setSource} />
  )}
</AdminFormField>
```

`labelId` 可保留既有下拉控件的标签关联。抓取中心的 `ScrapeField` 继续保留原调用接口，内部复用 `AdminFormField`。业务专属的复杂分组不需要硬改成普通字段。

## 状态标签

状态使用 `AdminStatusBadge`，由业务明确选择 `tone`：`success`、`info`、`warning`、`danger`、`accent`、`brand`、`muted`、`subtle` 或 `neutral`。颜色和背景统一由 `components/status-badges.css` 与主题变量提供。`accent` 是浅色强调底，`brand` 是原有完整强调色底。

```tsx
<AdminStatusBadge tone={failed ? 'danger' : 'success'}>
  {failed ? '失败' : '已完成'}
</AdminStatusBadge>
```

内容分级使用 `AdminContentRatingBadge`：`general` 显示“一般”，`restricted` 显示“限制级”，`unknown` 和缺失值显示“未标注”。需要额外说明时可传 `children`，不修改原分级值或审核逻辑。类别、计数、候选序号等非状态信息继续使用基础 `Badge`。

## 弹窗

后台统一使用 `AdminDialogContent`，保留基础 `Dialog`、`DialogHeader`、`DialogTitle`、`DialogDescription`、`DialogFooter` 的组合方式：

| 变体 | 使用场景 |
| --- | --- |
| `form`（默认） | 标准三段式配置、审核、导入与抓取弹窗 |
| `editor` | 小说编辑、章节编辑与章节融合，共用紧凑首尾间距 |
| `reading` | 长正文、输入 Prompt；`size="wide"` 扩大阅读空间，`fixedHeight` 保持编辑窗口高度 |
| `preview` | 图片预览 |

标准正文区使用 `AdminDialogBody`。复杂的内容编辑、批次操作和图片预览保留自己的内部滚动区，只将外壳尺寸与外观交给共用层。

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <AdminDialogContent variant="editor">
    <DialogHeader>
      <DialogTitle>编辑小说</DialogTitle>
      <DialogDescription>修改作品信息。</DialogDescription>
    </DialogHeader>
    <AdminDialogBody>{fields}</AdminDialogBody>
    <DialogFooter>{actions}</DialogFooter>
  </AdminDialogContent>
</Dialog>
```

所有后台变量都在 `:root` 定义，深色主题在同一文件覆盖，确保渲染到 `body` 下的 Radix portal 能继承。共用外壳保留 portal、焦点圈定、Escape 关闭和焦点返回行为。前台弹窗继续使用基础 UI 组件，不隐式套后台样式。

## 维护边界与验收

重复三次以上且用途相同的模式优先抽到共用层。AI 创作、抓取步骤、画像校正等业务布局仍留在对应页面模块；不用一套配置表强行生成所有页面。

重构需要分别检查类型、已有业务测试、构建和实际浏览器布局。重点检查 900/901px 表格边界、360/390px 窄屏、明暗主题、表单标签关联、弹窗独立滚动和关闭后的焦点。模拟数据的组件预览只能证明相关结构与样式，不能代替真实管理员操作和 API 验收。


## 运行监控入口

侧边栏的“运行监控”统一提供“任务中心”和“调用与用量”。任务中心按抓取任务、AI 任务、下载记录切换，保留各类型的业务列表和操作；调用与用量按 AI 调用、出站请求切换，AI 趋势与明细共享最近 7 / 30 / 90 天，明细类型筛选不影响总体趋势。趋势可折叠。

页面视图和时间范围使用 URL 查询参数，刷新、分享和浏览器前进后退可恢复。旧 `/admin/jobs`、`/admin/ai?sub=tasks`、`sub=usage`、`sub=audit` 使用替换跳转兼容，并保留其余查询参数；AI 旧的持久化子页也映射到新入口。代理设置保留配置和诊断操作，通过“查看出站请求记录”进入监控页。

`TaskCenterTab`、`CallsTab` 负责页面编排；`JobsTab` 可以按视图嵌入，`OutboundLogsPanel` 负责出站记录读取和刷新。切换视图时卸载非当前面板，避免隐藏列表继续轮询。各业务接口、权限和任务动作保持既有契约。


任务中心采用简短执行摘要与面板外状态筛选。抓取和 AI 表格均为五列，作品为主字段，任务 ID / 类型、进度 / 结果和速度 / 耗时按关联性组合。`TaskWorkspace` 复用后台弹窗组件提供摘要与详情外壳；终止和删除收进详情，重试与查看产出保留行内入口。详情操作关闭当前弹窗后进入原有确认流程。AI 继续保留服务端支持的独立状态筛选与 15 / 20 / 50 / 100 分页档位，Prompt 结构化阅读和批次跳转不变。抓取重试增加明确确认，清除已结束继续使用确认时的任务 ID 快照。

## 账户与列表的紧凑视觉

用户目录、密码弹窗和账户入口的文字头像复用 `InitialAvatar`（`web/src/components/ui/initial-avatar.tsx`）：默认 36px，账户入口用 `size="inherit"` 保持原尺寸，头像加载失败后仍显示共享文字回退。“本人”使用 `Badge variant="identity"`，不再用账户页私有标签样式。

`AdminSearch` 默认 280px 宽、40px 高，白底细边且无静态阴影；业务布局可覆盖宽度，移动端随容器收缩。后台 `Button variant="secondary"` 用暖灰底、无描边，文字和高度沿用按钮优先级契约。筛选器和 outline 按钮继续遵循各自控件规则。

`AdminPanelHeading` 的 `.admin-panel-status` 使用自然宽度、无描边的暖灰数量胶囊，12px 常规字重。`AdminStatusBadge` 统一 11px、3px × 8px 内边距和胶囊圆角，角色和状态仅传 tone；info/accent 为浅奶茶，neutral 为暖灰，success/danger 为浅语义色。共享 token 位于全站 `tokens.css`，状态与计数样式分别在 `components/status-badges.css` 和 `components/panel-status.css`。

## 列表行密度与日期

`AdminDataPanel` 支持 `density="comfortable"`，适用于姓名、身份和双行时间信息的目录。默认 `compact` 保持现有列表密度。comfortable 桌面目标行高 76px、单元格上下 16px / 左右 20px；移动端连续卡片上下 16px、字段间距 8px，不固定高度。参数使用 `--admin-table-comfortable-*`，样式归属 `components/tables.css`，不改变字体与控件尺寸。

用户目录注册时间使用共享 `formatDate` 输出 `YYYY-MM-DD`，`time` 元素的 title 提供 `formatDateTime` 完整时间；登录保留相对时间。日期以浏览器本地时区格式化，与既有日期工具一致。
