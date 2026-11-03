import { describe, expect, it } from 'vitest'
import { assessWritingQuality, detectRepeatedOpening } from './ai-writing-quality'

describe('writing quality signals', () => {
  it('flags a clearly short chapter and clears that current warning after an edit', () => {
    expect(assessWritingQuality({ text: '正文。'.repeat(100), targetWords: 2000 }).warnings.map((w) => w.code)).toContain('short_chapter')
    expect(assessWritingQuality({ text: '正文。'.repeat(500), targetWords: 2000, editedSinceGeneration: true }).warnings).toEqual([])
  })
  it('records an upstream output limit separately from current body length after an edit', () => {
    const report = assessWritingQuality({ text: '正文。'.repeat(500), targetWords: 2000, finishReason: 'length', editedSinceGeneration: true })
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: 'output_limit', source: 'generation' }))
    expect(report.warnings.some((w) => w.code === 'short_chapter')).toBe(false)
  })
  it('does not invent an upstream failure when an old record lacks a finish reason', () => {
    expect(assessWritingQuality({ text: '正文。', targetWords: 0 }).warnings).toEqual([])
  })
  it('keeps title mismatch and boundary loss visible, clearing title concerns after correction', () => {
    const before = assessWritingQuality({ text: '一个一个词\n正文。', titleNeedsReview: true, largeBoundaryTruncation: true })
    expect(before.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['title_format', 'chapter_boundary']))
    const after = assessWritingQuality({ text: '正文。', titleNeedsReview: true, largeBoundaryTruncation: true, editedSinceGeneration: true })
    expect(after.warnings.map((w) => w.code)).toEqual(['chapter_boundary'])
  })
  it('reports repeated scene openings only for a substantial exact passage', () => {
    const passage = '林舟走进书房，把铜钥匙放在桌上，等着沈月解释昨夜发生的事。窗外的雨声越来越密，脚步声在走廊里停住。'
    expect(detectRepeatedOpening(`${passage}\n\n继续。`, `前文。${passage}`)).toBe(true)
    expect(detectRepeatedOpening('他推开门。\n\n全新的剧情。', '他推开门。')).toBe(false)
    expect(assessWritingQuality({ text: passage, repeatedOpening: true }).warnings[0]?.code).toBe('repeated_opening')
  })
})
