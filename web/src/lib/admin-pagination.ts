/**
 * 后台分页的页大小契约（单一事实来源）。
 *
 * 为什么独立成模块、而不是放在 `Pagination.tsx` 里：
 * 该组件文件必须保持「只导出组件」，否则 `react-refresh/only-export-components`
 * 会报错（运行时常量导出会破坏 HMR 边界——改动常量导致整个组件模块重载，
 * 已挂载的列表状态全丢）。类型导出不受影响，常量不行。
 *
 * 默认 10 条是**展示层**契约，不是接口默认值：后端各列表路由未传 limit 时仍
 * 回落到 50，避免未显式传参的调用方（含公开页）突遭截断。需要「一次拉全」的
 * 页面显式传自己的 limit，不消费这里的默认值。
 *
 * 消费方式：`useState(ADMIN_DEFAULT_PAGE_SIZE)` 取初值，把
 * `ADMIN_PAGE_SIZE_OPTIONS` 传给 `<Pagination pageSize={{ options }}>`。
 * 不要再在各页面里手写 `useState(50)` 或字面档位数组——历史上小说 20 /
 * 章节 50 / 审计 50 / 生成内容 50 / 书源 50 五处分叉，正是这么来的。
 */
export const ADMIN_DEFAULT_PAGE_SIZE = 10

/** 每页条数下拉档位；默认值必须在其列，否则 Select 显示空白。 */
export const ADMIN_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
