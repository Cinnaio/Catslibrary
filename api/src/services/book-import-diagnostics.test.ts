import { describe, expect, it } from 'vitest'
import { bookImportTestHelpers } from './book-import'

const helpers = bookImportTestHelpers()

describe('import diagnostics', () => {
  it('统计切分结果并给出章节编号区间', () => {
    const text = ['第1章 起', '正文甲，足够长的一段内容用来避免被判定为空章。', '第2章 承', '正文乙，同样足够长的一段内容。'].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '正常.txt')

    expect(payload.chapters).toHaveLength(2)
    expect(diagnostics.stats.parser).toBe('text')
    expect(diagnostics.stats.chapterCount).toBe(2)
    expect(diagnostics.stats.headingLines).toBe(2)
    expect(diagnostics.stats.numbering).toMatchObject({ detected: 2, min: 1, max: 2, missing: 0, duplicated: 0 })
    expect(diagnostics.anomalies.map((item) => item.code)).not.toContain('chapters-missing')
  })

  it('最大编号远大于章节数时告警漏切', () => {
    // 中段标题写法变了、整段被并进上一章，是「90 章的文件只认出 45 章」的形态。
    const text = ['第1章 a', '正文。', '第2章 b', '正文。', '第3章 c', '正文。', '第4章 d', '正文。', '第100章 e', '正文。'].join('\n')
    const { diagnostics } = helpers.parseTextImportDetailed(text, '漏切.txt')

    expect(diagnostics.stats.numbering.max).toBe(100)
    expect(diagnostics.anomalies.map((item) => item.code)).toContain('chapters-missing')
  })

  it('章节中位字数极低时告警切碎', () => {
    const lines: string[] = []
    for (let index = 1; index <= 12; index++) lines.push(`第${index}章 标题`, `短句${index}。`)
    const { diagnostics } = helpers.parseTextImportDetailed(lines.join('\n'), '切碎.txt')

    expect(diagnostics.stats.chapterCount).toBe(12)
    expect(diagnostics.anomalies.map((item) => item.code)).toContain('chapters-fragmented')
  })

  it('编号大量重复时告警伪章节', () => {
    const lines: string[] = []
    for (let index = 1; index <= 12; index++) lines.push(`第${index}章 标题`, '正文内容。')
    // 追加 4 个与既有编号重复的标题：章节数虚高，编号却不连续增长。
    for (let index = 1; index <= 4; index++) lines.push(`第${index}章 重抄`, '正文内容。')
    const { diagnostics } = helpers.parseTextImportDetailed(lines.join('\n'), '重号.txt')

    expect(diagnostics.stats.numbering.duplicated).toBe(4)
    expect(diagnostics.anomalies.map((item) => item.code)).toContain('numbering-duplicated')
  })

  it('全文无章节标题时告警并保留单章', () => {
    const { payload, diagnostics } = helpers.parseTextImportDetailed('这是一段没有任何章节标题的正文。\n第二行。', '无标题.txt')

    expect(payload.chapters).toHaveLength(1)
    expect(diagnostics.stats.headingLines).toBe(0)
    expect(diagnostics.anomalies.map((item) => item.code)).toContain('no-heading-detected')
  })

  it('缩进的紧贴数字行被否决但仍留作待复核证据', () => {
    // 「117骗了她！」带缩进 → 判为正文。但它也可能是缩进排版的真章节标题，
    // 所以必须进证据列表让复核有机会翻案。
    const text = ['第1章 起', '正文甲。', '   117骗了她！', '正文继续。'].join('\n')
    const { diagnostics } = helpers.parseTextImportDetailed(text, '缩进.txt')
    const evidence = diagnostics.uncertain.find((row) => row.line === 3)

    expect(evidence?.verdict).toBe('prose')
    expect(evidence?.rejectedBy).toBe('leading-indent')
  })

  it('无编号章名被标为待复核而不是静默丢弃', () => {
    const text = ['序章', '序章正文。', '第1章 起', '正文。'].join('\n')
    const { diagnostics } = helpers.parseTextImportDetailed(text, '序章.txt')
    const evidence = diagnostics.uncertain.find((row) => row.line === 1)

    expect(evidence?.verdict).toBe('prose')
    expect(evidence?.rejectedBy).toBe('unnumbered-heading-shape')
    expect(diagnostics.anomalies.map((item) => item.code)).toContain('uncertain-lines')
  })

  it('证据行带上下文且总数独立于截断', () => {
    const text = ['第1章 起', '正文甲。', '   117骗了她！', '正文继续。'].join('\n')
    const { diagnostics } = helpers.parseTextImportDetailed(text, '上下文.txt')
    const evidence = diagnostics.uncertain[0]!

    expect(evidence.contextBefore).toBe('正文甲。')
    expect(evidence.contextAfter).toBe('正文继续。')
    expect(diagnostics.uncertainTotal).toBe(diagnostics.uncertain.length)
  })

  it('结构化来源没有行级证据', async () => {
    const json = JSON.stringify({ title: '书', author: '人', chapters: [{ title: '第1章', order: 1, content: '正文内容。' }] })
    const result = await helpers.parseUploadedBookDetailed('书.json', new TextEncoder().encode(json))

    expect(result.diagnostics.stats.parser).toBe('json')
    expect(result.diagnostics.uncertain).toHaveLength(0)
    expect(result.diagnostics.stats.chapterCount).toBe(1)
  })
})

describe('import heading overrides', () => {
  it('强制行号把漏判的章名切成独立章节', () => {
    const text = ['序章', '序章正文。', '第1章 起', '正文。'].join('\n')
    const before = helpers.parseTextImportDetailed(text, '序章.txt')
    const after = helpers.parseTextImportDetailed(text, '序章.txt', { forceHeadings: [1] })

    // 未覆盖时「序章」在前置块里，整段不足一章体量被丢弃，只剩第 1 章。
    expect(before.payload.chapters).toHaveLength(1)
    expect(after.payload.chapters).toHaveLength(2)
    expect(after.payload.chapters[0]?.title).toBe('序章')
    expect(after.payload.chapters[0]?.content).toContain('序章正文')
  })

  it('否决行号把误判的正文行从章节边界移除', () => {
    const text = ['第1章 起', '正文甲。', '2 她不想说话', '正文乙。'].join('\n')
    const before = helpers.parseTextImportDetailed(text, '误判.txt')
    const after = helpers.parseTextImportDetailed(text, '误判.txt', { denyHeadings: [3] })

    expect(before.payload.chapters).toHaveLength(2)
    expect(after.payload.chapters).toHaveLength(1)
    expect(after.payload.chapters[0]?.content).toContain('她不想说话')
  })

  it('被覆盖的行不再作为待复核证据', () => {
    const text = ['序章', '序章正文。', '第1章 起', '正文。'].join('\n')
    const after = helpers.parseTextImportDetailed(text, '序章.txt', { forceHeadings: [1] })

    expect(after.diagnostics.uncertain.some((row) => row.line === 1)).toBe(false)
  })

  it('覆盖不改变章节编号归一化与幂等键', () => {
    // 幂等键是增量导入的命脉：AI 只提供边界，键的生成必须与启发式路径完全一致。
    const text = ['第1章 起', '正文甲。', '第2章 承', '正文乙。'].join('\n')
    const plain = helpers.parseTextImportDetailed(text, '键.txt')
    const forced = helpers.parseTextImportDetailed(text, '键.txt', { forceHeadings: [1, 3] })

    expect(forced.payload.chapters.map((chapter) => helpers.importChapterKey(chapter.title))).toEqual(
      plain.payload.chapters.map((chapter) => helpers.importChapterKey(chapter.title)),
    )
  })
})

it('全文扫描时，后半本高风险行不会被前 1200 条候选挤掉', () => {
  const content = [...Array.from({ length: 1250 }, () => '1短标题\n正文。'), '序章', '序章正文。'].join('\n')
  const { diagnostics } = helpers.parseTextImportDetailed(content, '后半本.txt')
  expect(diagnostics.uncertain[0]?.raw).toBe('序章')
  expect(diagnostics.uncertain[0]?.line).toBe(2501)
  expect(diagnostics.uncertainTotal).toBe(1251)
  expect(diagnostics.truncatedCount).toBe(951)
})

it('复核上下文跳过附近的空行', () => {
  const { diagnostics } = helpers.parseTextImportDetailed('上一段正文。\n\n序章\n\n序章正文。', '空行.txt')
  expect(diagnostics.uncertain[0]).toMatchObject({ contextBefore: '上一段正文。', contextAfter: '序章正文。' })
})

it('人工强制边界保持裸编号的归一化与导入键', () => {
  const content = '  0012短标题\n正文。'
  const result = helpers.parseTextImportDetailed(content, '强制.txt', { forceHeadings: [1] })
  expect(result.payload.chapters[0]?.title).toBe('0012 短标题')
})

/**
 * 编号缺口回填。
 *
 * 实测《同时做四个人的金丝雀》第 15 章标题 47 字、第 32 章标题 70 字，都是真章节，
 * 却因超过长度阈值被判为正文，文件名写着「更38」而只切出 36 章。阈值不能放宽
 * （会把正文首句吃成标题），真正的判据是全文编号序列的连续性。
 */
describe('编号缺口回填', () => {
  /** 长度确定超过 MAX_CHAPTER_TITLE_LENGTH 的章名。 */
  const longTitle = '长'.repeat(45)

  it('补回因超长被否决的章名，无需人工或 AI 复核', () => {
    const text = [
      '第0014章 套话',
      '正文甲。',
      `第0015章\t景谅声公开暗示/和段闻透明玻璃花房play（好长的一章可以给我珠珠奖励一下吗！）`,
      '正文乙。',
      '第0016章 电影院',
      '正文丙。',
    ].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '长章名.txt')

    expect(payload.chapters).toHaveLength(3)
    expect(diagnostics.stats.numbering).toMatchObject({ detected: 3, min: 14, max: 16, missing: 0 })
    expect(payload.chapters[1]?.title).toContain('景谅声公开暗示')
    // 已由规则确定，不该再占用复核额度。
    expect(diagnostics.uncertainTotal).toBe(0)
    expect(diagnostics.anomalies.map((item) => item.code)).toContain('numbering-gap-filled')
  })

  it('裸编号的超长章名同样补回', () => {
    const text = [
      '31 他是谁？',
      '正文甲。',
      '32 沈冬聆只是偶然地，幸运地，接近了星星的轨迹，相交过后各自回归自己的世界，她仍有自己的生活要开启，而他继续做那个聚光灯前万众瞩目的星星。',
      '正文乙。',
      '33 只要能拥有她，我不介意和你分享。',
      '正文丙。',
    ].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '裸编号长章名.txt')

    expect(payload.chapters).toHaveLength(3)
    expect(payload.chapters[1]?.title).toContain('沈冬聆')
    expect(diagnostics.uncertainTotal).toBe(0)
  })

  it('回填出来的幂等键与常规路径一致', () => {
    // 键一旦分叉，增量导入会把库里已存在的章节整片误判成新增。
    const text = ['第0014章 套话', '正文甲。', `第0015章 ${longTitle}`, '正文乙。', '第0016章 电影院', '正文丙。'].join('\n')
    const { payload } = helpers.parseTextImportDetailed(text, '键一致.txt')
    const rescued = helpers.parseTextImportDetailed(text, '键一致.txt', { forceHeadings: [3] })

    expect(helpers.importChapterKey(payload.chapters[1]!.title)).toBe('#15')
    expect(payload.chapters.map((chapter) => helpers.importChapterKey(chapter.title))).toEqual(
      rescued.payload.chapters.map((chapter) => helpers.importChapterKey(chapter.title)),
    )
  })

  it('缺口填不满时不回填，避免把跳号当成漏判', () => {
    // 14 → 17 之间只有 15 一个候选：文件本身跳号，不能假定 15 就是边界。
    const text = ['第0014章 套话', '正文甲。', `第0015章 ${longTitle}`, '正文乙。', '第0017章 尾声', '正文丙。'].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '跳号.txt')

    expect(payload.chapters).toHaveLength(2)
    expect(diagnostics.uncertainTotal).toBe(1)
    expect(diagnostics.anomalies.map((item) => item.code)).not.toContain('numbering-gap-filled')
  })

  it('缺口内出现多个同号候选时整段放弃', () => {
    // 正文里恰好也有一行以「第0015章」开头的长句时，无法判定哪一条是边界。
    const text = ['第0014章 套话', '正文甲。', `第0015章 ${longTitle}`, '正文乙。', `第0015章 ${longTitle}`, '正文丙。', '第0016章 电影院', '正文丁。'].join(
      '\n',
    )
    const { payload } = helpers.parseTextImportDetailed(text, '同号候选.txt')

    expect(payload.chapters).toHaveLength(2)
  })

  it('确定否决的理由不参与回填', () => {
    // 「2 楼」是论坛楼层，形态上确定不是章节；编号缺口不能把它救成第 2 章。
    const text = ['第1章 起', '正文甲。', '2 楼', '正文乙。', '第3章 承', '正文丙。'].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '楼层.txt')

    expect(payload.chapters).toHaveLength(2)
    expect(diagnostics.anomalies.map((item) => item.code)).not.toContain('numbering-gap-filled')
  })

  it('没有后继章节时不回填', () => {
    // 末章之后无法用编号连续性判断，仍交给复核。
    const text = ['第1章 起', '正文甲。', `第2章 ${longTitle}`, '正文乙。'].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '末章.txt')

    expect(payload.chapters).toHaveLength(1)
    expect(diagnostics.uncertainTotal).toBe(1)
  })

  it('多章连续被否决时整段补回', () => {
    const text = ['第0014章 套话', '正文甲。', `第0015章 ${longTitle}`, '正文乙。', `第0016章 ${longTitle}`, '正文丙。', '第0017章 尾声', '正文丁。'].join('\n')
    const { payload, diagnostics } = helpers.parseTextImportDetailed(text, '连续缺两章.txt')

    expect(payload.chapters).toHaveLength(4)
    expect(diagnostics.stats.numbering).toMatchObject({ detected: 4, min: 14, max: 17, missing: 0 })
  })
})
