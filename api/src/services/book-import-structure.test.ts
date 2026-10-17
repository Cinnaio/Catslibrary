import { describe, expect, it } from 'vitest'
import { buildChapterDiff, parseTextImportDetailed } from './book-import'

describe('front matter and repeated export chapters', () => {
  it('keeps numbered preface lists out of the chapter catalog, while retaining an empty reward chapter', () => {
    const p = parseTextImportDetailed(
      '作者：样本\n简介：\n\n作品说明。\n\n1. 单主角\n2. 欢迎阅读\n3. 更新说明\n\n0001 01、开篇\n正文一。\n第0002章 打赏章，随缘！\n\n0003 03、归途\n正文三。',
    )
    expect(p.payload.chapters.map((c) => c.title)).toEqual(['0001 01、开篇', '第0002章 打赏章，随缘！', '0003 03、归途'])
    expect(p.payload.chapters[1]?.content.trim()).toBe('')
    expect(p.diagnostics.stats.numbering.duplicated).toBe(0)
  })

  it('reads named synopsis sections across blank lines without creating a front chapter', () => {
    const preface = `简介：设定说明。\n\n食用须知：\n${'阅读说明。'.repeat(70)}\n\n剧情简介：\n${'剧情介绍。'.repeat(70)}\n\nps：\n补充说明。`
    const p = parseTextImportDetailed(`题名：候选作品\n作者：样本\nTag列表：历史\n${preface}\n\n001 开篇\n正文。`)
    expect(p.payload.title).toBe('候选作品')
    expect(p.payload.chapters).toHaveLength(1)
    expect(p.payload.description).toContain('剧情简介：')
    expect(p.payload.description).toContain('补充说明。')
    expect(p.diagnostics.stats.frontMatterChars).toBe(0)
  })

  it('does not swallow a real unnumbered first body after an inline synopsis', () => {
    const body = '没有标题的首章正文。'.repeat(80)
    const p = parseTextImportDetailed(`简介：介绍。\n\n${body}\n第2章 归途\n正文二。`)
    expect(p.payload.chapters[0]?.content).toContain(body)
    expect(p.payload.chapters).toHaveLength(2)
  })

  it('does not turn ordinary dotted chapters before a later numbering format into metadata', () => {
    const p = parseTextImportDetailed('作者：样本\n1.开篇\n正文一。\n2.途中\n正文二。\n第3章 归途\n正文三。')
    expect(p.payload.chapters).toHaveLength(3)
  })
  it('does not classify consecutive empty notices as preface lists without a description context', () => {
    const p = parseTextImportDetailed('作者：样本\n1.公告\n2.说明\n第1章 开篇\n正文。')
    expect(p.payload.chapters).toHaveLength(3)
    expect(p.payload.chapters[0]?.title).toBe('1.公告')
  })

  it('merges same-title nonempty chapters only when the body differs in whitespace alone', () => {
    const p = parseTextImportDetailed('第1章 开篇\n相同的正文。\n另一段。\n第2章 途中\n正文二。\n第1章 开篇\n相同的 正文。\n\n另一段。')
    expect(p.payload.chapters).toHaveLength(2)
    expect(p.payload.chapters[0]?.content).toContain('相同的正文。')
    expect(p.diagnostics.anomalies.some((a) => a.message.includes('重复'))).toBe(true)
    expect(p.chapterRanges?.[1]?.endLine).toBe(5)
  })

  it('retains same-title chapters with even a single character changed, requiring a version choice', () => {
    const p = parseTextImportDetailed('第1章 开篇\n原始正文甲。\n第1章 开篇\n原始正文乙。')
    expect(p.payload.chapters).toHaveLength(2)
    const diffs = buildChapterDiff(p.payload, [])
    expect(diffs.every((c) => !c.selected)).toBe(true)
    expect(diffs.every((c) => c.reason.includes('版本'))).toBe(true)
    expect(diffs.map((c) => c.incomingOrder)).toEqual([1, 1])
  })

  it('does not merge different-titled chapters containing the same short placeholder body', () => {
    const p = parseTextImportDetailed('第1章 开篇\n待更新。\n第2章 归途\n待更新。')
    expect(p.payload.chapters).toHaveLength(2)
  })
  it('does not merge identically titled placeholders under distinct chapter numbers', () => {
    const p = parseTextImportDetailed('第1章 公告\n待更新。\n第2章 公告\n待更新。')
    expect(p.payload.chapters).toHaveLength(2)
  })
  it('requires choosing between an explicit wrong-chapter entry and a differently named same-number chapter', () => {
    const p = parseTextImportDetailed('0059 错章，稍后修正\n旧版正文。\n0059 归途\n新版正文。')
    const diffs = buildChapterDiff(p.payload, [])
    expect(diffs[0]?.variantGroup).toBeTruthy()
    expect(diffs[0]?.variantGroup).toBe(diffs[1]?.variantGroup)
    expect(diffs.every((c) => !c.selected)).toBe(true)
  })
  it('groups layered Chinese author numbering consistently across export numbering changes', () => {
    const p = parseTextImportDetailed('第九十四章 状元游街\n正文甲。\n第0102章 第九十四章 状元游街\n正文乙。')
    const d = buildChapterDiff(p.payload, [])
    expect(d[0]?.variantGroup).toBeTruthy()
    expect(d[0]?.variantGroup).toBe(d[1]?.variantGroup)
    expect(d.map((c) => c.incomingOrder)).toEqual([1, 1])
  })
  it('keeps repeated chapter numbers and titles in explicitly different volumes independent', () => {
    const p = parseTextImportDetailed('第一卷\n第1章 开篇\n相同正文。\n第二卷\n第1章 开篇\n相同正文。')
    expect(p.payload.chapters).toHaveLength(2)
    expect(p.payload.chapters.map((c) => c.volumeTitle)).toEqual(['第一卷', '第二卷'])
    const d = buildChapterDiff(p.payload, [])
    expect(d.every((c) => !c.variantGroup && c.selected)).toBe(true)
  })
})
