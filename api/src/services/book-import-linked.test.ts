import { describe, expect, it } from 'vitest'
import { buildChapterDiff, chapterNumberFromTitle, parseTextImportDetailed, probeChapterHeadingLine } from './book-import'

describe('import / title fusion / supplementary update contracts', () => {
  it('recognizes a standalone synopsis across blank paragraphs without adding a front chapter', () => {
    const synopsis = ['简短说明。', '简介段落。'.repeat(130)].join('\n\n')
    const { payload, diagnostics } = parseTextImportDetailed(
      `《候选作品》\n\n作者：样本作者\n\n内容简介\n\n${synopsis}\n\n第0001章 初见\n第一章正文。\n第0002章 归途\n第二章正文。`,
      '候选作品.txt',
    )
    expect(payload.title).toBe('候选作品')
    expect(payload.description).toBe(synopsis)
    expect(payload.chapters.map((c) => c.title)).toEqual(['第0001章 初见', '第0002章 归途'])
    expect(diagnostics.stats.frontMatterChars).toBe(0)
  })

  it('reports dropped empty entries before a retained front chapter is inserted', () => {
    const { diagnostics } = parseTextImportDetailed(`${'未标标题的首章正文。'.repeat(80)}\n第1章\n\n第2章 归途\n正文。`, '样本.txt')
    expect(diagnostics.stats.droppedEmptyChapters).toBe(1)
  })

  it('keeps named empty chapter entries without shifting the following chapter order', () => {
    const { payload, diagnostics } = parseTextImportDetailed('第0008章 前文\n正文八。\n第0009章 打赏章，随缘！\n\n第0010章 后文\n正文十。', '保留空章.txt')
    expect(payload.chapters.map((c) => c.title)).toEqual(['第0008章 前文', '第0009章 打赏章，随缘！', '第0010章 后文'])
    expect(payload.chapters[1]?.content.trim()).toBe('')
    expect(payload.chapters.map((c) => c.order)).toEqual([1, 2, 3])
    expect(diagnostics.stats.droppedEmptyChapters).toBe(0)
    expect(diagnostics.stats.numbering).toMatchObject({ missing: 0, duplicated: 0 })
    expect(parseTextImportDetailed('1 公告\n\n2 出发\n正文。').payload.chapters).toHaveLength(2)
  })

  it('extracts dotted, English and tight chapter numbers for diagnostics and long-heading rescue', () => {
    expect(chapterNumberFromTitle('30.归途')).toBe(30)
    expect(chapterNumberFromTitle('Chapter 31 Home')).toBe(31)
    expect(chapterNumberFromTitle('0032归途')).toBe(32)
    expect(chapterNumberFromTitle('12.5公里的路')).toBeNull()
    const { payload } = parseTextImportDetailed(`1.启程\n正文一。\n2.${'很长的章名'.repeat(12)}\n正文二。\n3.归途\n正文三。`)
    expect(payload.chapters).toHaveLength(3)
  })

  it('keeps reward announcements in the preceding body', () => {
    expect(probeChapterHeadingLine('100珠的加更送上啦，感谢支持').title).toBeNull()
    expect(probeChapterHeadingLine('12珠帘后的秘密').title).not.toBeNull()
  })

  it('never rescues a prose number that already has an accepted chapter', () => {
    const { payload } = parseTextImportDetailed('第1章 起点\n正文一。\n2是什么，以前没有听过。\n第2章 途中\n正文二。\n第3章 归途\n正文三。')
    expect(payload.chapters).toHaveLength(3)
    expect(payload.chapters[0]!.content).toContain('2是什么')
  })

  it('requires rescued numbers to occur between their chapter anchors in the original file', () => {
    const { payload } = parseTextImportDetailed(`第2章 ${'长'.repeat(50)}\n说明文字。\n第1章 起点\n正文一。\n第3章 归途\n正文三。`)
    expect(payload.chapters.map((c) => c.title)).toEqual(['第1章 起点', '第3章 归途'])
  })

  it('excludes numeric relationship tags and prose round/class expressions from headings', () => {
    for (const line of ['1v1，双洁', '第一回合在游戏中结束了。', '第一节课是英语课。']) expect(probeChapterHeadingLine(line).title).toBeNull()
  })

  it('reimport after source-title fusion uses a unique body match, preventing duplicate insertion', () => {
    const book = { title: '候选作品', author: '样本', chapters: [{ title: '第0011章 10.归途（微h）', order: 11, content: '一份能够唯一识别的原始正文。' }] }
    const local = [
      { id: 'existing', title: '10.归途', sort_order: 10, content: book.chapters[0]!.content, source_url: 'https://source.example/books/1/articles/10' },
    ]
    const [diff] = buildChapterDiff(book, local)
    expect(diff?.localChapterId).toBe('existing')
    expect(diff?.status).toBe('changed')
    expect(diff?.selected).toBe(false)
  })

  it('does not assign two incoming chapters to the same local chapter', () => {
    const local = [{ id: 'existing', title: '归途', sort_order: 1, content: '原始正文。', source_url: '' }]
    const diffs = buildChapterDiff({ title: '作品', author: '样本', chapters: [1, 2].map((order) => ({ title: '归途', order, content: '原始正文。' })) }, local)
    expect(diffs.map((c) => c.status)).toEqual(['unchanged', 'conflict'])
  })

  it('does not use a shared file URL as a unique chapter identity', () => {
    const url = 'https://dudu88.lanzov.com/iFile'
    const local = [1, 2].map((order) => ({
      id: `local-${order}`,
      title: `第${order}章 标题${order}`,
      sort_order: order,
      content: `正文${order}。`,
      source_url: url,
    }))
    const diffs = buildChapterDiff(
      {
        title: '作品',
        author: '样本',
        chapters: [1, 2].map((order) => ({ title: `第${order}章 标题${order}`, order, content: `正文${order}。`, sourceUrl: url })),
      },
      local,
    )
    expect(diffs.map((c) => c.status)).toEqual(['unchanged', 'unchanged'])
    expect(diffs.map((c) => c.localChapterId)).toEqual(['local-1', 'local-2'])
  })

  it('does not let a positional file fragment override the body after reparsing removes a front page', () => {
    const url = 'https://dudu88.lanzov.com/iFile'
    const local = [
      { id: 'front', title: '正文', sort_order: 1, content: '旧解析误收录的简介。', source_url: `${url}#chapter=1` },
      { id: 'chapter', title: '第一章 初见', sort_order: 2, content: '真正的第一章正文。', source_url: `${url}#chapter=2` },
    ]
    const [diff] = buildChapterDiff(
      { title: '作品', author: '样本', chapters: [{ title: '第一章 初见', order: 1, content: '真正的第一章正文。', sourceUrl: `${url}#chapter=1` }] },
      local,
    )
    expect(diff?.localChapterId).toBe('chapter')
  })

  it('surfaces even one missing or duplicated number for human review', () => {
    const missing = parseTextImportDetailed('第1章 起点\n正文一。\n第3章 归途\n正文三。')
    expect(missing.diagnostics.anomalies.map((a) => a.code)).toContain('numbering-gaps')
    const duplicate = parseTextImportDetailed('第1章 起点\n正文一。\n第1章 归途\n正文二。')
    expect(duplicate.diagnostics.anomalies.map((a) => a.code)).toContain('numbering-duplicated')
  })

  it('supplementary tails append after fused orders and never move existing chapters', () => {
    const local = [{ id: 'existing', title: '起点', sort_order: 2, content: '正文一。', source_url: '' }]
    const book = {
      title: '作品',
      author: '样本',
      chapters: [
        { title: '第1章 起点', order: 1, content: '正文一。' },
        { title: '第2章 归途', order: 2, content: '正文二。' },
      ],
    }
    const diffs = buildChapterDiff(book, local, { preserveLocalOrder: true })
    expect(diffs.map((c) => c.incomingOrder)).toEqual([2, 3])
    expect(diffs.map((c) => c.status)).toEqual(['changed', 'new'])
    const middle = buildChapterDiff({ ...book, chapters: [...book.chapters].reverse() }, local, { preserveLocalOrder: true })
    expect(middle[0]).toMatchObject({ status: 'conflict', selected: false })
  })
})
