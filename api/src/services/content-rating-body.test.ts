import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { BODY_MAX_TOTAL_CHARS, loadContentRatingBodySample, normalizeBodyText, pickEvidenceWindow } from './content-rating-body'
import { RESTRICTED_BODY_KEYWORDS } from '@shared/restricted-patterns'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
})

afterAll(async () => {
  await t.close()
})

async function seedNovel(id: string): Promise<void> {
  await t.db.query("INSERT INTO novels(id,title,author,content_rating,created_at,updated_at) VALUES($1,$1,'作者','unknown',1,1)", [id])
}

async function seedChapter(novelId: string, index: number, title: string, content: string): Promise<void> {
  await t.db.query(
    'INSERT INTO chapters(id,novel_id,title,content,sort_order,word_count,created_at) VALUES($1,$2,$3,$4,$5,$6,1)',
    [`${novelId}-c${index}`, novelId, title, content, index, content.length],
  )
}

/** 用《入红尘》那类正文取样：元数据干净，正文是硬核色情。 */
const EXPLICIT_TEXT =
  '她早就湿透了。淋漓丰沛的淫液不停外溢，那张小小的穴开合着，等待抚慰填满。' +
  '他握着性器，往下按压，抵着肉缝上下抚弄。就像将花瓣层层破开一般，两片花唇渐渐外翻。'

const PLAIN_TEXT = '清晨的山雾散得很慢，他沿着石阶往上走，心里盘算着今日的功课，风吹过袖口，带着松针的气味。'

describe('正文证据采样', () => {
  it('没有正文的作品返回 hasBody=false，不伪造样本', async () => {
    await seedNovel('body-empty')
    const sample = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-empty')
    expect(sample.hasBody).toBe(false)
    expect(sample.chapterCount).toBe(0)
    expect(sample.excerpts).toEqual([])
    expect(sample.keywordHits).toEqual([])
  })

  it('定位含成人词的章节，并把命中片段排在均匀样本之前', async () => {
    await seedNovel('body-match')
    await seedChapter('body-match', 1, '初入山门', PLAIN_TEXT)
    await seedChapter('body-match', 2, '夜话', PLAIN_TEXT)
    await seedChapter('body-match', 3, '操穴', EXPLICIT_TEXT)
    await seedChapter('body-match', 4, '下山', PLAIN_TEXT)

    const sample = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-match')
    expect(sample.hasBody).toBe(true)
    expect(sample.chapterCount).toBe(4)
    expect(sample.matchedChapterCount).toBe(1)
    expect(sample.matchedChapterRatio).toBe(0.25)
    // keywordHits 只保留命中项，且按命中章节数排序
    expect(sample.keywordHits.length).toBeGreaterThan(0)
    expect(sample.keywordHits.every((item) => item.chapters === 1)).toBe(true)
    expect(sample.keywordHits.map((item) => item.keyword)).toContain('淫液')

    // 命中片段必须带着原文，且能从章节号回溯到具体章节
    const matched = sample.excerpts.filter((item) => item.origin === 'match')
    expect(matched).toHaveLength(1)
    expect(matched[0]).toMatchObject({ chapterTitle: '操穴', chapterOrder: 3 })
    expect(matched[0]!.text).toContain('淫液')
    expect(matched[0]!.keywords.length).toBeGreaterThan(0)
    // 呈现顺序：命中在先，均匀抽样在后
    expect(sample.excerpts[0]!.origin).toBe('match')
    expect(sample.excerpts.some((item) => item.origin === 'spread')).toBe(true)
  })

  it('全书都干净时仍给出均匀样本，让模型能判断“确实没有”而不是“没看”', async () => {
    await seedNovel('body-clean')
    for (let index = 1; index <= 12; index++) await seedChapter('body-clean', index, `第${index}节`, `${PLAIN_TEXT}（第${index}节）`)

    const sample = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-clean')
    expect(sample.hasBody).toBe(true)
    expect(sample.matchedChapterCount).toBe(0)
    expect(sample.keywordHits).toEqual([])
    expect(sample.excerpts.length).toBeGreaterThan(0)
    expect(sample.excerpts.every((item) => item.origin === 'spread')).toBe(true)
  })

  it('同一本书两次采样结果完全一致，AI 建议才可复核', async () => {
    await seedNovel('body-stable')
    for (let index = 1; index <= 20; index++) {
      await seedChapter('body-stable', index, `第${index}节`, index % 5 === 0 ? EXPLICIT_TEXT : `${PLAIN_TEXT}（第${index}节）`)
    }
    const first = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-stable')
    const second = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-stable')
    expect(second).toEqual(first)
    expect(first.matchedChapterCount).toBe(4)
  })

  it('采样文本总量受限，且命中片段优先占用预算', async () => {
    await seedNovel('body-budget')
    for (let index = 1; index <= 30; index++) {
      await seedChapter('body-budget', index, `第${index}节`, `${EXPLICIT_TEXT}${'后面还有很长的正文。'.repeat(200)}`)
    }
    const sample = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-budget')
    const totalChars = sample.excerpts.reduce((total, item) => total + item.text.length, 0)
    expect(totalChars).toBeLessThanOrEqual(BODY_MAX_TOTAL_CHARS)
    expect(sample.excerpts.length).toBeGreaterThan(0)
  })

  it('规范化会清掉标签、零宽字符与多余空白', () => {
    expect(normalizeBodyText('<p>她&nbsp;湿了</p>\n\n  第二天')).toBe('她 湿了 第二天')
    expect(normalizeBodyText('前\u200b后')).toBe('前后')
  })

  it('窗口对准证据密集处，而不是第一个命中词出现的铺垫句', async () => {
    await seedNovel('body-window')
    // 铺垫段里埋一个弱词（胸口），成人描写排在其后。若按「第一个命中词」开窗，
    // 420 字里会全是剧情，审核员打开片段看不到任何判级依据。
    const leadIn = `${'清晨的山雾散得很慢，他沿着石阶往上走。'.repeat(20)}她胸口一紧，随即压下情绪。${'他继续往山上走，心里盘算着今日的功课。'.repeat(20)}`
    await seedChapter('body-window', 1, '上山', leadIn)
    await seedChapter('body-window', 2, '温泉', `${leadIn}${EXPLICIT_TEXT}`)

    const sample = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-window')
    const matched = sample.excerpts.filter((item) => item.origin === 'match' && item.chapterOrder === 2)
    expect(matched).toHaveLength(1)
    // 片段必须真的落在成人描写上，而不是停在前面那段铺垫里
    expect(matched[0]!.text).toContain('性器')
    expect(matched[0]!.strongKeywords).toContain('性器')
    // 铺垫段里那个弱词不应该出现在选中窗口内
    expect(matched[0]!.weakKeywords).not.toContain('胸口')
  })

  it('办案与医疗剧情里的药物词只算弱信号，不能被当成直白描写', async () => {
    await seedNovel('body-medical')
    // 真实场景：悬疑剧情写「体内检出催情药物」。它命中信号词，但完全不是色情描写。
    // 这类词必须留在弱信号里，否则会把整本正常作品渲染成「含直白描写」。
    await seedChapter('body-medical', 1, '笔录', '警察给受害人做了尿液检测和血液检测，结果显示其体内有催情药物，嫌疑人已被控制。')
    await seedChapter('body-medical', 2, '收网', '他握着性器，抵着肉缝上下抚弄，淋漓丰沛的淫液不停外溢。')

    const sample = await loadContentRatingBodySample(t.db.query.bind(t.db), 'body-medical')
    const plot = sample.excerpts.find((item) => item.chapterOrder === 1)
    const explicit = sample.excerpts.find((item) => item.chapterOrder === 2)
    expect(plot?.strongKeywords).toEqual([])
    expect(plot?.weakKeywords).toContain('催情')
    expect(explicit?.strongKeywords.length).toBeGreaterThan(0)
  })
})

describe('证据窗口选择', () => {
  const indexOf = (keyword: string) => RESTRICTED_BODY_KEYWORDS.findIndex((item) => item.keyword === keyword)

  /** 构造位置数组：只有列出的下标带命中位置，其余为 NULL。 */
  function positionsOf(entries: Array<[string, number]>): Array<number | null> {
    const positions: Array<number | null> = new Array(RESTRICTED_BODY_KEYWORDS.length).fill(null)
    for (const [keyword, pos] of entries) positions[indexOf(keyword)] = pos
    return positions
  }

  it('取窗口内命中权重之和最大的位置，而不是最靠前的命中', () => {
    // 弱词在前（权重 1），强词在后（权重 3）：必须选强词那一窗
    const start = pickEvidenceWindow(positionsOf([['胸口', 50], ['淫液', 1_200]]), 2_000, 420, 200)
    expect(start).toBe(1_000)
  })

  it('同权重时取更靠前的窗口，保证采样可复现', () => {
    const start = pickEvidenceWindow(positionsOf([['淫液', 300], ['性器', 1_200]]), 2_000, 420, 200)
    expect(start).toBe(100)
  })

  it('窗口不会越过章节末尾，避免片段被截成几个字', () => {
    const start = pickEvidenceWindow(positionsOf([['淫液', 480]]), 500, 420, 200)
    expect(start).toBe(81)
  })

  it('没有命中时回到章节开头', () => {
    expect(pickEvidenceWindow(new Array(RESTRICTED_BODY_KEYWORDS.length).fill(null), 2_000, 420, 200)).toBe(1)
  })
})
