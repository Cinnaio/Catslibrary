/**
 * AI 面板的枚举与文案映射（纯函数，无 JSX）。
 *
 * 为什么是 .ts 而不是 shared.tsx：`react-refresh/only-export-components` 只对
 * 含组件的文件报警——在 shared.tsx 里导出工具函数会让该模块无法 fast refresh
 * （改一个映射常量就整块重载，已挂载面板的状态全丢）。同理见
 * `lib/admin-pagination.ts`。shared.tsx 只保留真正的组件。
 *
 * 这里的映射是唯一来源。此前 `AiTasksPanel`、`AiWritingPanel` 各自维护一份
 * taskKindLabel/taskStatusLabel，三份枚举表互不一致，导致 `rewrite_selection`
 * 在任务列表里直接吐出英文原始值。
 */

const KIND_LABELS: Record<string, string> = {
  summary: '前情提要',
  catchup: '回顾总结',
  write_outline: '创作大纲',
  write_chapter: '创作章节',
  continue: '续写',
  rewrite_selection: '选段改写',
  cover: '封面',
  cover_prompt: '封面描述词',
}

/**
 * 任务/产物类型的中文名。
 * 兜底返回原值而非「未知」：后端新增 kind 时，看到原始枚举比看到「未知」
 * 更容易定位是漏了映射。
 */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
}

/** 任务状态的中文名。 */
export function taskStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}

/** taskStepText 只依赖这几个字段，用结构类型参数避免耦合到完整 AiTaskInfo。 */
export interface TaskStepInput {
  status: string
  step: string
  current: number
  total: number
  createdAt: number
  finishedAt: number
}

/**
 * 任务列表「结果」列的文案 —— 不能直接透传服务端的 step，实测有三类问题：
 *
 * 1. 终态任务仍显示进行中文案。31 条 failed 里 11 条的 step 停在「AI 正在生成」，
 *    另有 3 条是「正在生成封面（prompt：…」。状态已是失败，步骤却像在跑，
 *    用户会以为任务还活着。故终态一律不展示进行中措辞。
 * 2. 封面任务的 step 把整段图像 prompt 塞了进来（实测最长 255 字符、平均 127），
 *    在一列里渲染成一大段英文，把该列的语义压垮。这类 step 只取首个短语。
 * 3. 已完成任务的 step 与「状态」列的 Badge 完全重复（实测 27 条 step 就是
 *    「已完成」）。该列改说耗时，避免与「进度」列的 current/total 也重复。
 *
 * 兜底用 step 原值：后端改动措辞时，列表能继续显示真实内容而不是空白。
 */
export function taskStepText(task: TaskStepInput): string {
  if (task.status === 'failed') return task.step && !isProgressStep(task.step) ? shortStep(task.step) : '未完成'
  if (task.status === 'cancelled') return '已取消'
  if (task.status === 'queued') return task.step ? shortStep(task.step) : '等待调度'
  if (task.status === 'completed') {
    // 完成后真正新增的信息是耗时（实测 66/66 条 finishedAt 均可用）。
    const ms = task.finishedAt > 0 ? task.finishedAt - task.createdAt : 0
    return ms > 0 ? `耗时 ${formatDuration(ms)}` : '已完成'
  }
  return task.step ? shortStep(task.step) : '处理中'
}

/** step 是否为「进行中」措辞；这类文案在终态下具有误导性。 */
function isProgressStep(step: string): boolean {
  return /正在|生成中|处理中|排队|等待/.test(step)
}

/** 封面类任务的 step 混入了整段图像 prompt，只保留「（」之前的短语。 */
function shortStep(step: string): string {
  const cut = step.indexOf('（')
  return (cut > 0 ? step.slice(0, cut) : step).trim()
}

/** 耗时人类化：秒级保留整数，分钟级带一位小数，小时级只给整数分钟。 */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} 分钟`
  return `${Math.round(minutes)} 分钟`
}
