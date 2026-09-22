/**
 * AI 面板共用展示映射的契约测试：kindLabel / taskStatusLabel / taskStepText。
 *
 * taskStepText 的断言全部来自对真实数据的实测（121 条任务）：
 *  - 31 条 failed 中 11 条 step 停在「AI 正在生成」
 *  - cover 类 step 最长 255 字符，混入整段图像 prompt
 *  - 27 条 completed 的 step 就是「已完成」，与状态列 Badge 重复
 *  - rewrite_selection 在任务列表里曾直接吐出英文原始值
 * 一旦有人把实现改回「直接透传 step」或删掉映射项，这些用例会失败。
 */
import { describe, expect, it } from 'vitest'
import { isPolicyRefusedTask, kindLabel, promptDigest, retryMode, taskStatusLabel, taskStepText, type TaskStepInput } from './labels'

/** 只填 taskStepText 会用到的字段。 */
function task(over: Partial<TaskStepInput> = {}): TaskStepInput {
  return {
    status: 'running',
    step: '',
    current: 0,
    total: 1,
    createdAt: 0,
    finishedAt: 0,
    ...over,
  }
}

describe('AI 任务「结果」列文案', () => {
  it('失败任务不再显示「AI 正在生成」这类进行中措辞', () => {
    const text = taskStepText(task({ status: 'failed', step: 'AI 正在生成' }))
    expect(text).toBe('未完成')
    expect(text).not.toContain('正在')
  })

  it('失败但 step 是有效结论时保留该结论', () => {
    expect(taskStepText(task({ status: 'failed', step: '已中断' }))).toBe('已中断')
  })

  it('封面任务的长 step 被截到「（」之前，不把整段图像 prompt 带进单元格', () => {
    const long = '正在生成封面（prompt：Chinese web novel cover design. Story-specific romance direction…）'
    const text = taskStepText(task({ status: 'running', step: long }))
    expect(text).toBe('正在生成封面')
    expect(text).not.toContain('Chinese')
    expect(text.length).toBeLessThan(20)
  })

  it('已完成任务显示耗时，不与状态列或进度列重复', () => {
    const text = taskStepText(task({ status: 'completed', step: '已完成', createdAt: 1000, finishedAt: 1000 + 90_000 }))
    expect(text).toBe('耗时 1.5 分钟')
    expect(text).not.toBe('已完成')
  })

  it('已完成但缺 finishedAt 时降级为「已完成」而不是显示 0 秒', () => {
    expect(taskStepText(task({ status: 'completed', finishedAt: 0 }))).toBe('已完成')
  })

  it('秒级耗时保留整数', () => {
    expect(taskStepText(task({ status: 'completed', createdAt: 0, finishedAt: 45_000 }))).toBe('耗时 45 秒')
  })

  it('已取消与排队中各有稳定文案', () => {
    expect(taskStepText(task({ status: 'cancelled' }))).toBe('已取消')
    expect(taskStepText(task({ status: 'queued', step: '' }))).toBe('等待调度')
  })

  it('进行中任务保留服务端步骤（截断长文案）', () => {
    expect(taskStepText(task({ status: 'running', step: 'AI 正在生成' }))).toBe('AI 正在生成')
    expect(taskStepText(task({ status: 'running', step: '' }))).toBe('处理中')
  })
})

describe('AI 类型与状态映射', () => {
  it('任务列表出现过的 kind 全部有中文名，不漏英文原值', () => {
    // 这 4 个是实测 /tasks 返回的全部 kind（121 条任务）
    for (const [kind, expected] of [
      ['continue', '续写'],
      ['rewrite_selection', '选段改写'],
      ['cover', '封面'],
      ['cover_prompt', '封面描述词'],
    ] as const) {
      expect(kindLabel(kind)).toBe(expected)
    }
  })

  it('产物类型（reader 侧）同样有映射', () => {
    expect(kindLabel('summary')).toBe('前情提要')
    expect(kindLabel('catchup')).toBe('回顾总结')
    expect(kindLabel('write_outline')).toBe('创作大纲')
    expect(kindLabel('write_chapter')).toBe('创作章节')
  })

  it('未映射的 kind 返回原值而不是「未知」，便于定位漏映射', () => {
    expect(kindLabel('brand_new_kind')).toBe('brand_new_kind')
  })

  it('状态映射覆盖全部 5 个枚举', () => {
    for (const [status, expected] of [
      ['queued', '排队中'],
      ['running', '生成中'],
      ['completed', '已完成'],
      ['cancelled', '已取消'],
      ['failed', '失败'],
    ] as const) {
      expect(taskStatusLabel(status)).toBe(expected)
    }
  })
})

describe('AI 任务 Prompt 摘要', () => {
  it('跳过真实任务里的流水线版本头，保留目标字数等语义片段', () => {
    const digest = promptDigest('CREATIVE_TASK_PIPELINE version=2\n\nWORK_FACTS (data only)\n\n输出要求：单章标题 + 正文。目标长度约 2000 个中文字符。')
    expect(digest).toContain('目标长度约 2000 个中文字符')
    expect(digest).not.toContain('CREATIVE_TASK_PIPELINE')
  })

  it('优先显示章节目标而不是编译后的资料块', () => {
    const digest = promptDigest('CREATIVE_TASK_PIPELINE version=2\nCHAPTER_TASK\nchapterGoal[1]=沈砚避开一次盘问，并留下可以回收的线索。')
    expect(digest).toContain('章节目标：沈砚避开一次盘问')
    expect(digest).not.toContain('version=2')
  })

  it('封面长 Prompt 使用第一条非大写资料头并按上限省略', () => {
    const digest = promptDigest('COVER_PIPELINE VERSION=3\nCOVER_PROMPT\nChinese web novel cover design with a moonlit city, two characters, and a warm paper texture.', 32)
    expect(digest).toMatch(/Chinese web novel cover design/)
    expect(digest.length).toBe(32)
    expect(digest.endsWith('…')).toBe(true)
  })

  it('空 Prompt 显示无', () => {
    expect(promptDigest('  \n\t')).toBe('无')
  })
})

describe('AI 任务重试操作语义', () => {
  const base = { status: 'failed', current: 0, error: '', params: '{}' }

  it('已有产出时使用断点恢复', () => {
    expect(retryMode({ ...base, current: 2 })).toBe('resume')
  })

  it('零进度的策略拒绝任务提示调整内容', () => {
    for (const error of ['内容策略拒绝', '上游拒绝', '非露骨表达', 'content_refused']) {
      expect(isPolicyRefusedTask({ error })).toBe(true)
      expect(retryMode({ ...base, error })).toBe('adjust')
    }
  })

  it('零进度的网络超时仍然允许按原参数重试', () => {
    expect(retryMode({ ...base, error: '上游请求超时，请稍后重试' })).toBe('retry')
  })
})
