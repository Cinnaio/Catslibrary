import { describe, expect, it } from 'vitest'
import type { BookImportLineEvidence } from '@shared/types'
import { buildImportReviewMessage, parseImportReviewReply } from './import-assist'

/** raw 只在提示词用例里参与断言，解析用例用默认占位即可。 */
function candidate(line: number, raw = `候选行 ${line}`, verdict: 'heading' | 'prose' = 'prose'): BookImportLineEvidence {
  return { line, raw, verdict, rule: 'prose', confidence: 'low', contextBefore: '上一行内容', contextAfter: '下一行内容' }
}

describe('import review reply parsing', () => {
  it('只保留候选集合内的行号', () => {
    const candidates = [candidate(12), candidate(47), candidate(88)]
    const result = parseImportReviewReply('{"headings":[12,47,999]}', candidates)

    // 999 不在候选里：模型臆造的行号若放行，会切出原文里并不存在的边界。
    expect([...result].sort((a, b) => a - b)).toEqual([12, 47])
  })

  it('容忍 Markdown 代码块与解释文字', () => {
    const candidates = [candidate(5), candidate(9)]
    const reply = '分析如下：\n```json\n{"headings": [5]}\n```\n以上。'

    expect([...parseImportReviewReply(reply, candidates)]).toEqual([5])
  })

  it('JSON 不可解析时退化为数字提取', () => {
    const candidates = [candidate(3), candidate(7)]

    expect([...parseImportReviewReply('应为 3 与 7', candidates)].sort((a, b) => a - b)).toEqual([3, 7])
  })

  it('空回复得到空集合而不是全部候选', () => {
    expect(parseImportReviewReply('', [candidate(1)]).size).toBe(0)
  })

  /**
   * 模型明确回空数组是在否决全部候选。若把它当解析失败落入数字兜底，
   * 解释文字里的数字会被当成标题行号——把否决反向执行成强制命中。
   */
  it('合法空数组被视为「都不是标题」，不落入数字兜底', () => {
    const candidates = [candidate(12), candidate(47)]
    const reply = '{"headings":[]}\n说明：第 12 行与第 47 行都判为正文。'

    expect(parseImportReviewReply(reply, candidates).size).toBe(0)
  })

  it('JSON 里的行号不在候选内时不会被兜底补回', () => {
    const candidates = [candidate(12)]
    const reply = '{"headings":[999]}\n参考第 12 行。'

    expect(parseImportReviewReply(reply, candidates).size).toBe(0)
  })

  it('重复行号去重', () => {
    const candidates = [candidate(6)]
    expect([...parseImportReviewReply('{"headings":[6,6,6]}', candidates)]).toEqual([6])
  })
})

describe('import review prompt', () => {
  it('把候选行渲染成带上下文的紧凑表格', () => {
    const message = buildImportReviewMessage([candidate(12, '序章')])

    expect(message).toContain('12 | 序章')
    expect(message).toContain('上一行')
    expect(message).toContain('下一行')
    expect(message).toContain('请输出 JSON')
  })

  it('超长原文与上下文被截断，避免 token 失控', () => {
    const long = '字'.repeat(500)
    const message = buildImportReviewMessage([candidate(1, long, 'heading')])
    const row = message.split('\n')[1]!

    expect(row.length).toBeLessThan(300)
  })
})
