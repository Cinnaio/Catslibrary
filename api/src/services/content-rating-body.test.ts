import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { BODY_MAX_TOTAL_CHARS, loadContentRatingBodySample, normalizeBodyText } from './content-rating-body'

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
})
