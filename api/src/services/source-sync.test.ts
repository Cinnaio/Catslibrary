import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { PgScrapeStore } from './scraper/store'
import {
  applySourceSync,
  createSourceSyncPreview,
  refreshSourceSync,
  sourceSyncTestHelpers,
  type LocalChapterForSync,
  type SourceChapter,
  type SourceSyncMetadata,
} from './source-sync'

// 目录 HTML 使用夹具，账号会话也显式提供夹具，避免依赖部署账号。
vi.mock('./source-account', () => ({
  getPo18Session: vi.fn().mockResolvedValue({ accountId: 'fixture-account', cookie: 'fixture-session=1' }),
}))

const metadata: SourceSyncMetadata = {
  title: '',
  author: '',
  description: '',
  coverUrl: '',
  category: '',
  categories: [],
  status: '',
  sourceUrl: 'https://www.jjwxc.net/onebook.php?novelid=1',
}

// 截图形态：正文中插入末尾番外，另有远距离同名「游戏」；序号应可按源站同步。
function reorderedBookCatalog() {
  const source = Array.from({length:182}, (_,i)=>({key:`s${i+1}`,order:i+1,title:`正文标题${i+1}`,url:''}))
  source[53]!.title = '游戏'
  for (let i=175;i<=179;i++) source[i-1]!.title = `番外：万圣节（${i-174}）`
  source[179]!.title = '番外：尾声'
  const local: LocalChapterForSync[] = [
    ...source.filter(row=>row.order<=104 && row.order!==54).map(row=>({id:`l${row.order}`,order:row.order,title:row.title})),
    ...source.filter(row=>row.order>=175 && row.order<=179).map(row=>({id:`l${row.order}`,order:row.order-69,title:row.title})),
    {id:'l105',order:111,title:source[104]!.title}, {id:'unmatched-game',order:112,title:'游戏'},
    ...source.filter(row=>row.order>=106 && row.order<=141).map(row=>({id:`l${row.order}`,order:row.order+7,title:row.title})),
    {id:'l180',order:149,title:source[179]!.title},
    ...source.filter(row=>row.order>=142 && row.order<=174).map(row=>({id:`l${row.order}`,order:row.order+8,title:row.title})),
  ]
  return {source,local}
}

it('截图中106→175的番外及关联正文可以按源站同步，不能因编排差异禁止修复', () => {
  const {source,local} = reorderedBookCatalog()
  const preview = sourceSyncTestHelpers().buildPreview(source,local,metadata,true,
    {runId:'screenshot-order',bindingId:'binding',novelId:'novel',site:'po18tw',sourceUrl:metadata.sourceUrl},[])
  expect(preview.orderChanges).toHaveLength(31)
  expect(preview.orderChanges).toContainEqual(expect.objectContaining({localChapterId:'l176',oldOrder:107,newOrder:176}))
  expect(preview.orderRepairSkipped).toContainEqual(expect.objectContaining({localChapterId:'l175',blockingChapterIds:['unmatched-game']}))
  expect(preview.unmatchedLocal.map(row=>row.id)).toEqual(['unmatched-game'])
  // 隔离回放：移除未知占位章后，76 条均应进入方案，而不是继续以编排差异拒绝。
  const cleared = sourceSyncTestHelpers().buildPreview(source,local.filter(row=>row.id!=='unmatched-game'),metadata,true,
    {runId:'cleared-order',bindingId:'binding',novelId:'novel',site:'po18tw',sourceUrl:metadata.sourceUrl},[])
  expect(cleared.orderChanges).toHaveLength(76)
  expect(cleared.orderChanges).toContainEqual(expect.objectContaining({localChapterId:'l175',oldOrder:106,newOrder:175}))
})

function po18Directory(rows: Array<{ order: number; title: string }>): string {
  const chapters = rows
    .map(
      ({ order, title }) =>
        `<div class="c_l"><div class="l_counter">${String(order).padStart(4, '0')}</div><div class="l_chaptname"><a href="/books/902326/articles/${order}">${title}</a></div><div class="l_btn"><a href="/books/902326/articles/${order}">免費閱讀</a></div></div>`,
    )
    .join('')
  return `<html><head><title>本地书</title></head><body><div class="book_name">本地书</div>${chapters}</body></html>`
}

it.each([false,true])('番外重排事务可应用且可撤回，保留章节ID和正文（隔离移除未知占位=%s）', async cleared => {
  const novelId = `reordered-apply-${cleared}`
  const shape = reorderedBookCatalog()
  const locals = shape.local.filter(row=>!cleared || row.id!=='unmatched-game').map(row=>({...row,id:`${novelId}-${row.id}`}))
  await testDb.db.query('INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ($1,$2,$3,1,1)', [novelId,'排序回归书','作者'])
  for (const row of locals) await testDb.db.query('INSERT INTO chapters (id,novel_id,title,content,sort_order,word_count,created_at) VALUES ($1,$2,$3,$4,$5,4,1)', [row.id,novelId,row.title,'正文保持',row.order])
  const preview = await createSourceSyncPreview(testDb.db,{novelId,sourceUrl:'https://www.po18.tw/books/902326/articles',store:new PgScrapeStore(testDb.db),fetchHtml:async()=>({html:po18Directory(shape.source),encoding:'utf-8'})})
  expect(preview.orderChanges).toHaveLength(cleared?76:31)
  const result = await applySourceSync(testDb.db,{runId:preview.runId,repairOrder:true,confirmedOrderIds:preview.orderChanges.map(row=>row.localChapterId)})
  expect(result).toMatchObject({updated:0,orderUpdated:cleared?76:31})
  const rows = (await testDb.db.query<{id:string;title:string;content:string;sort_order:number}>('SELECT id,title,content,sort_order FROM chapters WHERE novel_id=$1',[novelId])).rows
  expect(rows).toHaveLength(locals.length)
  expect(new Set(rows.map(row=>Number(row.sort_order))).size).toBe(rows.length)
  for (const row of rows) {
    const before = locals.find(local=>local.id===row.id)!
    expect(row.content).toBe('正文保持')
    expect(row.title).toBe(before.title)
    expect(Number(row.sort_order)).toBe(preview.orderChanges.find(change=>change.localChapterId===row.id)?.newOrder ?? before.order)
  }
  const { rollbackSourceSync } = await import('./source-sync')
  expect((await rollbackSourceSync(testDb.db,preview.runId,'admin')).restored).toBe(cleared?76:31)
  const restored = (await testDb.db.query<{id:string;sort_order:number}>('SELECT id,sort_order FROM chapters WHERE novel_id=$1',[novelId])).rows
  expect(restored.every(row=>Number(row.sort_order)===locals.find(local=>local.id===row.id)!.order)).toBe(true)
})

let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb()
  await testDb.applyMigrations()
})

afterAll(async () => {
  await testDb.close()
})

describe('source sync chapter mapping', () => {
  it('加更珠数和正文标题里的数字不是章节编号', () => {
    const { chapterNumber } = sourceSyncTestHelpers()
    expect(chapterNumber('他注视着她【900珠加更】')).toBeNull()
    expect(chapterNumber('还有100天')).toBeNull()
    expect(chapterNumber('第0044章 他注视着她【900珠加更】')).toBe(44)
    expect(chapterNumber('Chapter 44')).toBe(44)
    expect(chapterNumber('第44')).toBe(44)
    expect(chapterNumber('38 36.5 论坛番外')).toBe(38)
  })
  it('本地重复序号造成公告与正文颠倒时，仍按完整标题匹配而不遗漏公告', () => {
    const source = [
      { key: 's43', order: 43, title: '会死人的【800珠加更】', url: '' },
      { key: 's44', order: 44, title: '他注视着她【900珠加更】', url: '' },
      { key: 's45', order: 45, title: '不行了，累累', url: '' },
      { key: 's46', order: 46, title: '没有喊哥哥', url: '' },
    ]
    const local = [
      { id: 'l43', order: 43, title: '会死人的【800珠加更】' },
      { id: 'l44', order: 44, title: '他注视着她【900珠加更】' },
      { id: 'l46', order: 46, title: '没有喊哥哥' },
      { id: 'l45', order: 46, title: '不行了，累累' },
    ]
    const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
      { runId: 'duplicate-order', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])
    expect(preview.mappings.map(row => [row.sourceOrder, row.localChapterIds[0]])).toEqual([
      [43, 'l43'], [44, 'l44'], [45, 'l45'], [46, 'l46'],
    ])
    expect(preview.unmatchedSource).toEqual([])
    expect(preview.unmatchedLocal).toEqual([])
    expect(preview.orderChanges).toEqual([{ localChapterId: 'l45', title: '不行了，累累', oldOrder: 46, newOrder: 45 }])
    expect(preview.warnings.some(warning => warning.includes('重复序号：46'))).toBe(true)
  })

  it.each(['unchanged', 'reordered', 'renamed', 'added', 'deleted'] as const)('序号修复保留正文与章节 ID，并拒绝预览后的目录变化：%s', async (mutation) => {
    const novelId = `repair-order-${mutation}`
    const source = [
      { order: 43, title: '会死人的【800珠加更】' },
      { order: 44, title: '他注视着她【900珠加更】' },
      { order: 45, title: '不行了，累累' },
      { order: 46, title: '没有喊哥哥' },
    ]
    await testDb.db.query('INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ($1,$1,\'作者\',1,1)', [novelId])
    for (const chapter of source) {
      await testDb.db.query('INSERT INTO chapters (id,novel_id,title,content,sort_order,word_count,created_at) VALUES ($1,$2,$3,$4,$5,22,1)',
        [`${novelId}-${chapter.order}`, novelId, chapter.title, `正文 ${chapter.order}`, chapter.order === 45 ? 46 : chapter.order])
    }
    const preview = await createSourceSyncPreview(testDb.db, {
      novelId, sourceUrl: 'https://www.po18.tw/books/902326/articles', store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({ html: po18Directory(source), encoding: 'utf-8' }),
    })
    expect(preview.changes).toEqual([])
    expect(preview.orderChanges).toEqual([{ localChapterId: `${novelId}-45`, title: '不行了，累累', oldOrder: 46, newOrder: 45 }])
    if (mutation === 'reordered') await testDb.db.query('UPDATE chapters SET sort_order=47 WHERE id=$1', [`${novelId}-46`])
    if (mutation === 'renamed') await testDb.db.query('UPDATE chapters SET title=\'已修改的标题\' WHERE id=$1', [`${novelId}-46`])
    if (mutation === 'added') await testDb.db.query('INSERT INTO chapters (id,novel_id,title,sort_order,created_at) VALUES ($1,$2,\'新章\',47,1)', [`${novelId}-47`, novelId])
    if (mutation === 'deleted') await testDb.db.query('DELETE FROM chapters WHERE id=$1', [`${novelId}-46`])
    if (mutation !== 'unchanged') {
      await expect(applySourceSync(testDb.db, { runId: preview.runId, repairOrder: true })).rejects.toThrow('发生变化')
      const notice = await testDb.db.query<{ sort_order: number }>('SELECT sort_order FROM chapters WHERE id=$1', [`${novelId}-45`])
      expect(notice.rows[0]?.sort_order).toBe(46)
      return
    }
    const noRepair = await applySourceSync(testDb.db, { runId: preview.runId })
    expect(noRepair.orderUpdated).toBe(0)
    const next = await createSourceSyncPreview(testDb.db, {
      novelId, sourceUrl: 'https://www.po18.tw/books/902326/articles', store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({ html: po18Directory(source), encoding: 'utf-8' }),
    })
    const result = await applySourceSync(testDb.db, { runId: next.runId, repairOrder: true })
    expect(result).toMatchObject({ updated: 0, orderUpdated: 1 })
    const stored = await testDb.db.query<{ id: string; title: string; content: string; sort_order: number }>(
      'SELECT id,title,content,sort_order FROM chapters WHERE novel_id=$1 ORDER BY sort_order', [novelId])
    expect(stored.rows).toEqual(source.map(row => ({ id: `${novelId}-${row.order}`, title: row.title, content: `正文 ${row.order}`, sort_order: row.order })))
    await expect(applySourceSync(testDb.db, { runId: next.runId, repairOrder: true })).rejects.toThrow('已经应用')
  })

  it('重复标题、缺失本地匹配与拆分章节不开放序号修复', () => {
    const base = { runId: 'blocked-order', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }
    const build = sourceSyncTestHelpers().buildPreview
    const cases = [
      { source: ['同名章节', '同名章节'], local: ['同名章节', '同名章节'] },
      { source: ['对应章节'], local: ['对应章节', '未匹配的本地章'] },
      { source: ['第一章 暴雨'], local: ['第1章 (1/2)', '第1章 (2/2)'] },
    ]
    for (const example of cases) {
      const preview = build(example.source.map((title, index) => ({ key: `s${index}`, order: index + 1, title, url: '' })),
        example.local.map((title, index) => ({ id: `l${index}`, order: index + 1, title })), metadata, true, base, [])
      expect(preview.orderChanges).toEqual([])
      expect(preview.orderRepairBlockers).toEqual([])
    }
  })

  it('导入编号与作者编号不同且源站插入空白章时，按真实标题对齐后续章节', () => {
    const sourceTitles = ['9.泪水味道的初吻', '空白收费章（并没有内容！）', '10.千千万万遍', '11.恩将仇报的狗（微h）（加更）', '12.喧软奶香大馒头（微h）', '36.5.论坛番外（非男主意淫预警）', '38.我怎么可能会喜欢她', '【幻想if线】特别篇', '56.奸情败露']
    const localTitles = ['第0009章 9.泪水味道的初吻', '第0011章 10.千千万万遍', '第0012章 11.恩将仇报的狗（微h）（加更）', '第0013章 12.喧软奶香大馒头（微h）', '38 36.5 论坛番外（非男主意淫预警）', '40 38.我怎么可能会喜欢她', '第0058章 【幻想if线】特别篇', '59 56.奸情败露']
    const source = sourceTitles.map((title, index) => ({ key: `s-${index}`, order: index + 1, title, url: '' }))
    const local = localTitles.map((title, index) => ({ id: `l-${index}`, order: index + 1, title }))
    const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
      { runId: 'numbered-import', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])
    expect(preview.mappings.map(row => [row.localChapterIds[0], row.sourceChapterKey])).toEqual(
      local.map((row, index) => [row.id, `s-${index === 0 ? 0 : index + 1}`]),
    )
    expect(preview.unmatchedSource.map(row => row.title)).toEqual([sourceTitles[1]])
    expect(preview.unmatchedLocal).toEqual([])
    expect(preview.mappings.every(row => row.confidence === 'high')).toBe(true)
  })

  it('两侧剩余章节编号冲突且标题不同，保持未匹配而非强行生成更新', () => {
    const preview = sourceSyncTestHelpers().buildPreview(
      [{ key: 'source-10', order: 1, title: '10.旧日来信', url: '' }],
      [{ id: 'local-11', order: 1, title: '11.雨后重逢' }],
      metadata, true,
      { runId: 'conflicting-numbers', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [],
    )
    expect(preview.mappings).toEqual([])
    expect(preview.changes).toEqual([])
    expect(preview.unmatchedSource.map(row => row.key)).toEqual(['source-10'])
    expect(preview.unmatchedLocal.map(row => row.id)).toEqual(['local-11'])
  })

  it('将一个源站章节映射到多个带拆分标记的本地章节', () => {
    const source: SourceChapter[] = [{ key: 'source-12', order: 12, title: '第12章 暴雨', url: 'https://source.test/chapter/12' }]
    const local: LocalChapterForSync[] = [
      { id: 'local-12-a', order: 12, title: '第12章（1/3）' },
      { id: 'local-12-b', order: 13, title: '第12章（2/3）' },
      { id: 'local-12-c', order: 14, title: '第12章（3/3）' },
    ]

    const preview = sourceSyncTestHelpers().buildPreview(
      source,
      local,
      metadata,
      true,
      { runId: 'run-1', bindingId: 'binding-1', novelId: 'novel-1', site: 'jjwxc', sourceUrl: metadata.sourceUrl },
      [],
    )

    expect(preview.mappings).toHaveLength(1)
    expect(preview.mappings[0]).toMatchObject({ relation: 'split', localChapterIds: ['local-12-a', 'local-12-b', 'local-12-c'], confidence: 'high' })
    expect(preview.changes.map((change) => change.newTitle)).toEqual(['第12章 暴雨 (1/3)', '第12章 暴雨 (2/3)', '第12章 暴雨 (3/3)'])
    expect(preview.changes.every((change) => change.eligible)).toBe(true)
  })

  it('没有拆分标记且本地标题有内容时，只生成预览而不默认覆盖', () => {
    const source: SourceChapter[] = [{ key: 'source-1', order: 1, title: '第一章 新的开始', url: 'https://source.test/chapter/1' }]
    const local: LocalChapterForSync[] = [{ id: 'local-1', order: 1, title: '第一章 原有标题' }]

    const preview = sourceSyncTestHelpers().buildPreview(
      source,
      local,
      metadata,
      true,
      { runId: 'run-2', bindingId: 'binding-1', novelId: 'novel-1', site: 'jjwxc', sourceUrl: metadata.sourceUrl },
      [],
    )

    expect(preview.changes).toHaveLength(1)
    expect(preview.changes[0]).toMatchObject({ eligible: false, relation: 'one_to_one' })
  })

  it('拆分序号或拆分总数不连续时不跨章节误合并', () => {
    const local: LocalChapterForSync[] = [
      { id: 'local-a-1', order: 1, title: '第一章（1/3）' },
      { id: 'local-a-3', order: 2, title: '第一章（3/3）' },
      { id: 'local-b-2', order: 3, title: '第二章（2/4）' },
    ]

    const groups = sourceSyncTestHelpers().groupLocalChapters(local)

    expect(groups.map((group) => group.chapters.map((chapter) => chapter.id))).toEqual([['local-a-1'], ['local-a-3'], ['local-b-2']])
  })

  it('拆分标记连续但基础标题不同，不能把两章合为一组并覆盖第二章', () => {
    const groups = sourceSyncTestHelpers().groupLocalChapters([
      { id: 'storm', order: 1, title: '第一章 暴雨 (1/2)' },
      { id: 'night', order: 2, title: '第二章 夜行 (2/2)' },
    ])
    expect(groups.map(group => group.chapters.map(row => row.id))).toEqual([['storm'], ['night']])
  })

  it('本地拆分不完整时提示缺失部分，但只处理实际存在的章节', () => {
    const source: SourceChapter[] = [{ key: 'source-1', order: 1, title: '第一章 暴雨', url: 'https://source.test/chapter/1' }]
    const local: LocalChapterForSync[] = [
      { id: 'local-1-a', order: 1, title: '第一章（1/3）' },
      { id: 'local-1-b', order: 2, title: '第一章（2/3）' },
    ]

    const preview = sourceSyncTestHelpers().buildPreview(
      source,
      local,
      metadata,
      true,
      { runId: 'run-3', bindingId: 'binding-1', novelId: 'novel-1', site: 'jjwxc', sourceUrl: metadata.sourceUrl },
      [],
    )

    expect(preview.warnings.some((warning) => warning.includes('2/3'))).toBe(true)
    expect(preview.changes.map((change) => change.newTitle)).toEqual(['第一章 暴雨 (1/3)', '第一章 暴雨 (2/3)'])
  })

  it('番外章节缺失时按番外编号对齐，不把后续标题整体顺延', () => {
    const sourceTitles = [
      '番外一：学教骑马',
      '番外三：玉势顶弄泄他满手（H）',
      '番外四：两穴齐插，对镜喷水（H）',
      '番外五：塞花入穴，水中捣泄（H）',
      '番外六：穴中温酒，死去活来（H）',
      '推本完结新文《与姐婿》',
    ]
    const localTitles = [
      '番外一',
      '番外二（高h，野外马震）',
      '番外三（h，玉势，泄了他满手）',
      '番外四（高h，两穴齐插，对镜喷水）',
      '番外五（高h，塞花入穴，水中捣泄）',
      '【番外完】（高h，穴中温酒，死去活来）',
    ]
    const source = sourceTitles.map((title, index) => ({ key: `source-${index + 1}`, order: index + 1, title, url: '' }))
    const local = localTitles.map((title, index) => ({ id: `local-${index + 1}`, order: index + 1, title }))

    const preview = sourceSyncTestHelpers().buildPreview(
      source,
      local,
      metadata,
      true,
      { runId: 'run-extra', bindingId: 'binding-1', novelId: 'novel-1', site: 'po18tw', sourceUrl: metadata.sourceUrl },
      [],
    )
    const changesByLocalId = new Map(preview.changes.map((change) => [change.localChapterId, change]))

    expect(preview.unmatchedLocal.map((chapter) => chapter.id)).toContain('local-2')
    expect(preview.unmatchedSource.map((chapter) => chapter.key)).toContain('source-6')
    expect(changesByLocalId.get('local-3')).toMatchObject({ sourceTitle: sourceTitles[1], newTitle: sourceTitles[1] })
    expect(changesByLocalId.get('local-4')).toMatchObject({ sourceTitle: sourceTitles[2], newTitle: sourceTitles[2] })
    expect(changesByLocalId.get('local-5')).toMatchObject({ sourceTitle: sourceTitles[3], newTitle: sourceTitles[3] })
    expect(changesByLocalId.get('local-6')).toMatchObject({ sourceTitle: sourceTitles[4], newTitle: sourceTitles[4] })
  })

  it('融合预览应读取 288 章完整目录，再对齐本地 272 节，不能把末尾章节配到第一页', async () => {
    const novelId = 'paginated-sync-novel'
    await testDb.db.query('INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ($1, $2, $3, 1, 1)', [novelId, '分页书', '作者'])
    const source = Array.from({ length: 288 }, (_, index) => ({ order: index + 1, title: `旅途记录 ${index + 1}` }))
    const local = source.filter(row => row.order <= 282 && (row.order < 93 || row.order > 102))
    const values = local.flatMap((row, index) => [`paged-${index + 1}`, novelId, `第${row.order}章 ${row.title}`, index + 1])
    const placeholders = local.map((_, index) => {
      const offset = index * 4
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, 0, 1)`
    })
    await testDb.db.query(`INSERT INTO chapters (id, novel_id, title, sort_order, word_count, created_at) VALUES ${placeholders.join(',')}`, values)
    const base = 'https://www.po18.tw/books/902326/articles'
    const directoryRequests: string[] = []
    const preview = await createSourceSyncPreview(testDb.db, {
      novelId, sourceUrl: base, store: new PgScrapeStore(testDb.db),
      fetchHtml: async (url) => {
        if (!new URL(url).pathname.endsWith('/articles')) return { html: '<h1>分页书</h1>', encoding: 'utf-8' }
        directoryRequests.push(url)
        const page = Number(new URL(url).searchParams.get('page') || 1)
        return {
          html: po18Directory(source.slice((page - 1) * 100, page * 100)) + `<a href="${base}?page=3">末页</a>`,
          encoding: 'utf-8',
        }
      },
    })
    // 元数据探测会额外读取首页；目录提取必须先完成连续三页。
    expect(directoryRequests.slice(0, 3)).toEqual([base, `${base}?page=2`, `${base}?page=3`])
    expect(preview.sourceChapterCount).toBe(288)
    expect(preview.localChapterCount).toBe(272)
    expect(preview.matchedSourceCount).toBe(272)
    expect(preview.unmatchedSource).toHaveLength(16)
    expect(preview.unmatchedLocal).toEqual([])
    expect(preview.mappings.find(row => row.localChapterIds.includes('paged-268'))).toMatchObject({ sourceOrder: 278, confidence: 'high' })
    expect(preview.changes.every(row => row.sourceOrder === local[row.localOrder - 1]!.order)).toBe(true)
    const saved = await testDb.db.query<{ source_chapters_json: string }>('SELECT source_chapters_json FROM source_sync_runs WHERE id = $1', [preview.runId])
    expect(JSON.parse(saved.rows[0]!.source_chapters_json)).toHaveLength(288)
  })

  it.each([
    { label: '未完結', selected: true, expectedPreview: 'ongoing', expectedStored: 'ongoing' },
    { label: '未完結', selected: false, expectedPreview: 'ongoing', expectedStored: 'completed' },
    { label: '未知', selected: true, expectedPreview: '', expectedStored: 'completed' },
  ])('源站状态 $label、勾选 $selected 时，预览与实际同步保持一致', async ({ label, selected, expectedPreview, expectedStored }) => {
    const novelId = `status-sync-${label}-${selected}`
    await testDb.db.query('INSERT INTO novels (id, title, author, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 1, 1)',
      [novelId, '状态测试', '作者', 'completed'])
    const preview = await createSourceSyncPreview(testDb.db, {
      novelId, sourceUrl: 'https://www.po18.tw/books/902326', store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({
        html: po18Directory([{ order: 1, title: '第一章' }]) + `<dd class="statu">${label}<span>(目前1章回)</span></dd>`,
        encoding: 'utf-8',
      }),
    })
    expect(preview.metadata.status).toBe(expectedPreview)
    const result = await applySourceSync(testDb.db, {
      runId: preview.runId, applyMetadata: true, metadataFields: selected ? ['status'] : [], metadataMode: 'replace',
    })
    const stored = await testDb.db.query<{ status: string }>('SELECT status FROM novels WHERE id = $1', [novelId])
    expect(stored.rows[0]!.status).toBe(expectedStored)
    expect(result.metadataUpdated).toEqual(expectedStored === 'ongoing' ? ['status'] : [])
  })

  it('应用预览时只更新标题，并保存一对多映射', async () => {
    await testDb.db.query('INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)', ['sync-novel', '本地书', '作者', 1])
    await testDb.db.query(
      `INSERT INTO chapters (id, novel_id, title, sort_order, word_count, created_at)
       VALUES ($1, $2, $3, $4, 0, 1), ($5, $2, $6, $7, 0, 1), ($8, $2, $9, $10, 0, 1)`,
      ['sync-a', 'sync-novel', '第12章（1/3）', 12, 'sync-b', '第12章（2/3）', 13, 'sync-c', '第12章（3/3）', 14],
    )
    const preview = await createSourceSyncPreview(testDb.db, {
      novelId: 'sync-novel',
      sourceUrl: 'https://www.po18.tw/books/902326/articles',
      store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({ html: po18Directory([{ order: 12, title: '第12章 暴雨' }]), encoding: 'utf-8' }),
    })
    await expect(applySourceSync(testDb.db, { runId: preview.runId, repairOrder: true })).rejects.toThrow('无法修复序号')
    const applied = await applySourceSync(testDb.db, { runId: preview.runId })
    const rows = await testDb.db.query<{ id: string; title: string }>('SELECT id, title FROM chapters WHERE novel_id = $1 ORDER BY sort_order', ['sync-novel'])
    const mappings = await testDb.db.query<{ relation: string; part_count: number }>(
      'SELECT relation, part_count FROM source_chapter_mappings WHERE sync_run_id = $1 ORDER BY local_chapter_id',
      [preview.runId],
    )

    expect(applied.updated).toBe(3)
    expect(rows.rows.map((row) => row.title)).toEqual(['第12章 暴雨 (1/3)', '第12章 暴雨 (2/3)', '第12章 暴雨 (3/3)'])
    expect(mappings.rows).toHaveLength(3)
    expect(mappings.rows.every((row) => row.relation === 'split' && row.part_count === 3)).toBe(true)
  })

  it('人工确认时只应用被确认的低置信度章节名变更', async () => {
    await testDb.db.query('INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)', [
      'manual-sync-novel',
      '本地书',
      '作者',
      2,
    ])
    await testDb.db.query(
      `INSERT INTO chapters (id, novel_id, title, sort_order, word_count, created_at)
       VALUES ($1, $2, $3, $4, 0, 2), ($5, $2, $6, $7, 0, 2)`,
      ['manual-a', 'manual-sync-novel', '第一章 原标题', 1, 'manual-b', '第二章 原标题', 2],
    )

    const preview = await createSourceSyncPreview(testDb.db, {
      novelId: 'manual-sync-novel',
      sourceUrl: 'https://www.po18.tw/books/902326/articles',
      store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({
        html: po18Directory([
          { order: 1, title: '第一章 新标题' },
          { order: 2, title: '第二章 新标题' },
        ]),
        encoding: 'utf-8',
      }),
    })

    expect(preview.changes).toHaveLength(2)
    expect(preview.changes.every((change) => !change.eligible)).toBe(true)

    const applied = await applySourceSync(testDb.db, {
      runId: preview.runId,
      confirmedChangeIds: [preview.changes[0]!.localChapterId],
    })
    const rows = await testDb.db.query<{ id: string; title: string }>(
      'SELECT id, title FROM chapters WHERE novel_id = $1 ORDER BY sort_order',
      ['manual-sync-novel'],
    )

    expect(applied.updated).toBe(1)
    expect(rows.rows.map((row) => row.title)).toEqual(['第一章 新标题', '第二章 原标题'])
  })
  it('批量确认只更新选中标题，并直接替换勾选的小说信息', async () => {
    await testDb.db.query('INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)', [
      'batch-manual-novel', '旧书名', '保留的作者', 3,
    ])
    for (let order = 1; order <= 3; order++) {
      await testDb.db.query('INSERT INTO chapters (id, novel_id, title, sort_order, word_count, created_at) VALUES ($1, $2, $3, $4, 0, 3)', [
        `batch-manual-${order}`, 'batch-manual-novel', `第${order}章 原标题`, order,
      ])
    }
    const preview = await createSourceSyncPreview(testDb.db, {
      novelId: 'batch-manual-novel', sourceUrl: 'https://www.po18.tw/books/902326/articles',
      store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({ html: po18Directory([1, 2, 3].map(order => ({ order, title: `第${order}章 新标题` }))), encoding: 'utf-8' }),
    })
    expect(preview.changes).toHaveLength(3)
    expect(preview.changes.every(change => !change.eligible)).toBe(true)
    const result = await applySourceSync(testDb.db, {
      runId: preview.runId, confirmedChangeIds: ['batch-manual-1', 'batch-manual-3'],
      applyMetadata: true, metadataFields: ['title'], metadataMode: 'replace',
    })
    expect(result.updated).toBe(2)
    expect(result.metadataUpdated).toEqual(['title'])
    const titles = await testDb.db.query<{ title: string }>('SELECT title FROM chapters WHERE novel_id = $1 ORDER BY sort_order', ['batch-manual-novel'])
    expect(titles.rows.map(row => row.title)).toEqual(['第1章 新标题', '第2章 原标题', '第3章 新标题'])
    const novel = await testDb.db.query<{ title: string; author: string }>('SELECT title, author FROM novels WHERE id = $1', ['batch-manual-novel'])
    expect(novel.rows[0]).toEqual({ title: '本地书', author: '保留的作者' })
  })

})

it('连续偏移受阻时指出根本占用章节，并保留其他独立修复', () => {
  const source = [
    { key: 'a', order: 2, title: '第一章 起程', url: '' },
    { key: 'b', order: 3, title: '第二章 归途', url: '' },
    { key: 'c', order: 5, title: '第三章 重逢', url: '' },
  ]
  const local = [
    { id: 'a', order: 1, title: '第一章 起程' },
    { id: 'b', order: 2, title: '第二章 归途' },
    { id: 'blocked', order: 3, title: '未匹配公告' },
    { id: 'c', order: 4, title: '第三章 重逢' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'blocked-chain', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])
  expect(preview.orderChanges.map(row => row.localChapterId)).toEqual(['c'])
  for (const id of ['a', 'b']) {
    const skipped = preview.orderRepairSkipped?.find(row => row.localChapterId === id)
    expect(skipped?.blockingChapterIds).toEqual(['blocked'])
    expect(skipped?.reason).toContain('本地 3「未匹配公告」')
    expect(skipped?.reason).toContain('尚未匹配')
  }
})

describe('标题归一化剥离修饰词与污染标题', () => {
  const { normalizedTitle, isWeakTitle } = sourceSyncTestHelpers()

  it.each([
    ['被迫穿上情趣旗袍', '被迫穿上情趣旗袍（微H）'],
    ['被迫穿着旗袍自慰', '被迫穿着旗袍自慰（H）'],
    ['兄弟', '兄弟（微H）'],
    ['掉马「po1⒏homes」', '掉马'],
  ])('本地「%s」与源站「%s」归一化后相等', (local, source) => {
    expect(normalizedTitle(local)).toBe(normalizedTitle(source))
  })

  it.each([
    ['(H)', '半角括号'],
    ['（高h）', '小写h'],
    ['（H）（加更）', '标记后仍有正文'],
    ['（微h）（加更）', '微标记叠加正文'],
    ['（高H）', '高H'],
  ])('剥离 %s（%s）后保留正文', (title, reason) => {
    expect(reason).toBeTruthy()
    expect(normalizedTitle(title)).not.toContain('h')
  })

  it.each(['首-发：', '首-发', '首发', '防盗', '本章为防盗章'])('污染标题「%s」判为弱标题', (title) => {
    expect(isWeakTitle(title, 38)).toBe(true)
  })

  it('纯分级标记剥离后为空串，必须判弱以免成为空锚点', () => {
    for (const title of ['（H）', '（微H）', '(H)', '（高h）', '( 微 h )']) {
      expect(normalizedTitle(title)).toBe('')
      expect(isWeakTitle(title, 7)).toBe(true)
    }
  })

  it('含 H 的正常正文标题不被误剥离', () => {
    expect(normalizedTitle('他的心跳')).toBe('他的心跳')
    expect(normalizedTitle('H市往事')).toBe('h市往事')
    expect(normalizedTitle('她说她很happy')).toBe('她说她很happy')
    expect(isWeakTitle('他的心跳', 3)).toBe(false)
  })
})

it('污染标题不参与锚定，避免顶掉真实章节并推偏后续序号', () => {
  const source = [
    { key: 's37', order: 37, title: '项圈（微H）', url: '' },
    { key: 's38', order: 38, title: '失踪', url: '' },
    { key: 's39', order: 39, title: '笼子', url: '' },
  ]
  // 本地目录里插入了 PO18 防盜水印「首-发：」，把真实章节整体推后一位。
  const local = [
    { id: 'l37', order: 37, title: '项圈（微H）' },
    { id: 'l38', order: 38, title: '首-发：' },
    { id: 'l39', order: 39, title: '失踪' },
    { id: 'l40', order: 40, title: '笼子' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'watermark', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])
  // 水印章必须落进未匹配本地，而不是抢占源站第38章。
  expect(preview.unmatchedLocal.map(row => row.id)).toEqual(['l38'])
  expect(preview.mappings.map(row => [row.sourceOrder, row.localChapterIds[0]])).toEqual([[37, 'l37'], [38, 'l39'], [39, 'l40']])
})

it('同名章节按两侧序号顺序消歧，两个「自由」各归其位', () => {
  const titles = ['真空', '自由', '狗咬狗', '夹心三明治', '兄弟', '警犬', '遛狗', '最后的晚餐', '自由', '霸道总裁爱上我']
  const source = titles.map((title, index) => ({ key: `s${index}`, order: 90 + index, title, url: '' }))
  // 本地整体比源站靠后 1 位，两个「自由」分别位于第 92、99 章。
  const local = titles.map((title, index) => ({ id: `l${index}`, order: 91 + index, title }))
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'dup-title', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  expect(preview.unmatchedLocal).toEqual([])
  expect(preview.unmatchedSource).toEqual([])
  for (const [localIndex, order] of [[1, 91], [8, 98]] as const) {
    const mapping = preview.mappings.find(row => row.localChapterIds.includes(`l${localIndex}`))
    expect(mapping).toMatchObject({ sourceChapterKey: `s${order - 90}`, sourceOrder: order, confidence: 'high' })
  }
})

it('远离基准位置的巧合同名锚点被拒绝，不伪造确定性', () => {
  // 本地把源站第54章「游戏」的正文缺失，却在第112章另有一个同名「游戏」。
  const source = [
    { key: 's52', order: 52, title: '约会', url: '' },
    { key: 's53', order: 53, title: '发泄', url: '' },
    { key: 's54', order: 54, title: '游戏', url: '' },
    { key: 's55', order: 55, title: '出气', url: '' },
  ]
  const local = [
    { id: 'l52', order: 52, title: '约会' },
    { id: 'l53', order: 53, title: '发泄' },
    { id: 'l55', order: 55, title: '出气' },
    { id: 'l112', order: 112, title: '游戏' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'far-anchor', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  // 正确匹配必须保住。
  expect(preview.mappings.find(row => row.localChapterIds.includes('l53'))).toMatchObject({ sourceOrder: 53, confidence: 'high' })
  expect(preview.mappings.find(row => row.localChapterIds.includes('l55'))).toMatchObject({ sourceOrder: 55, confidence: 'high' })
  // 本地112的「游戏」不得以 high/exact-title 伪造确定性。
  const forged = preview.mappings.find(row => row.localChapterIds.includes('l112'))
  expect(forged?.confidence).not.toBe('high')
  expect(preview.unmatchedLocal.map(row => row.id)).toContain('l112')
})

it('导入残留序号前缀制造的纯清理修正可自动应用', () => {
  const source = [
    { key: 's83', order: 83, title: '阴差阳错', url: '' },
    { key: 's84', order: 84, title: '首长和太子', url: '' },
    { key: 's85', order: 85, title: '巧克力（微H）', url: '' },
  ]
  const local = [
    { id: 'l83', order: 83, title: '阴差阳错' },
    { id: 'l85', order: 85, title: '84.首长和太子' },
    { id: 'l86', order: 86, title: '巧克力（微H）' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'import-prefix', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  const change = preview.changes.find(row => row.localChapterId === 'l85')
  expect(change).toMatchObject({ newTitle: '首长和太子', sourceOrder: 84, confidence: 'high', eligible: true })
})

it('连续受阻记录按阻塞源聚合，明细逐章保留', () => {
  const source = [
    { key: 'a', order: 2, title: '第一章 起程', url: '' },
    { key: 'b', order: 3, title: '第二章 归途', url: '' },
    { key: 'c', order: 4, title: '第三章 重逢', url: '' },
    { key: 'd', order: 5, title: '第四章 远行', url: '' },
  ]
  const local = [
    { id: 'a', order: 1, title: '第一章 起程' },
    { id: 'blocked', order: 2, title: '未匹配公告' },
    { id: 'b', order: 3, title: '第二章 归途' },
    { id: 'c', order: 4, title: '第三章 重逢' },
    { id: 'd', order: 5, title: '第四章 远行' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'aggregate-blockers', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  // 逐章明细保留原有契约字段。
  expect(preview.orderRepairSkipped?.length).toBeGreaterThan(1)
  expect(preview.orderRepairSkipped?.every(row => typeof row.reason === 'string')).toBe(true)
  // 聚合摘要：同一阻塞源只出现一次，并列出全部受影响章节。
  const blockers = preview.orderRepairBlockers || []
  expect(blockers).toHaveLength(1)
  expect(blockers[0]).toMatchObject({ blockingChapterIds: ['blocked'] })
  expect(blockers[0]?.reason).toContain('本地 2「未匹配公告」')
  const covered = blockers.flatMap(row => row.affectedChapterIds)
  expect(covered).toEqual(preview.orderRepairSkipped?.filter(row => row.blockingChapterIds?.length).map(row => row.localChapterId))
  expect(new Set(covered).size).toBe(covered.length)
})

it('弱标题占位章占据的序号不会被静默覆盖', async () => {
  const novelId = 'weak-blocker-order'
  const source = [
    { order: 1, title: '教室里' },
    { order: 2, title: '失踪' },
    { order: 3, title: '笼子' },
  ]
  await testDb.db.query('INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ($1,$1,\'作者\',1,1)', [novelId])
  // 本地第2格被 PO18 防盜水印占据，导致「失踪」整体后移一位。
  const local = [
    { id: `${novelId}-n1`, title: '教室里', order: 1 },
    { id: `${novelId}-junk`, title: '首-发：', order: 2 },
    { id: `${novelId}-n2`, title: '失踪', order: 3 },
    { id: `${novelId}-n3`, title: '笼子', order: 4 },
  ]
  for (const row of local) {
    await testDb.db.query('INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ($1,$2,$3,\'正文保持\',$4,1)',
      [row.id, novelId, row.title, row.order])
  }
  const preview = await createSourceSyncPreview(testDb.db, {
    novelId, sourceUrl: 'https://www.po18.tw/books/902326/articles', store: new PgScrapeStore(testDb.db),
    fetchHtml: async () => ({ html: po18Directory(source), encoding: 'utf-8' }),
  })

  // 水印章不参与锚定，也不会被当成某章的配对目标。
  expect(preview.unmatchedLocal.map(row => row.id)).toEqual([`${novelId}-junk`])
  // 但「失踪」的目标号 2 被水印章实占：不能静默覆盖，必须留给人工处理。
  expect(preview.orderChanges).toEqual([])
  const missing = preview.orderRepairSkipped?.find(row => row.localChapterId === `${novelId}-n2`)
  expect(missing?.reason).toContain('被占位章占用')
  expect(missing?.blockingChapterIds).toEqual([`${novelId}-junk`])

  // 应用后目录保持原样，不产生重复序号。
  await expect(applySourceSync(testDb.db, { runId: preview.runId, repairOrder: true })).rejects.toThrow('无法修复序号')
  const stored = await testDb.db.query<{ id: string; sort_order: number }>(
    'SELECT id, sort_order FROM chapters WHERE novel_id=$1 ORDER BY id', [novelId])
  expect(stored.rows.map(row => [row.id.replace(`${novelId}-`, ''), row.sort_order])).toEqual([
    ['junk', 2], ['n1', 1], ['n2', 3], ['n3', 4],
  ])
})

it('差异仅来自被剥离的噪声标记时，修正可自动应用', () => {
  // 与「84.首长和太子」性质相同的确定性清理：分级标记与广告后缀。
  const source = [
    { key: 's78', order: 78, title: '被迫穿上情趣旗袍（微H）', url: '' },
    { key: 's94', order: 94, title: '兄弟（微H）', url: '' },
    { key: 's171', order: 171, title: '掉马', url: '' },
  ]
  const local = [
    { id: 'l79', order: 79, title: '被迫穿上情趣旗袍' },
    { id: 'l95', order: 95, title: '兄弟' },
    { id: 'l179', order: 179, title: '掉马「po1⒏homes」' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'noise-only', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  expect(preview.changes).toHaveLength(3)
  expect(preview.changes.every(row => row.confidence === 'high' && row.matchReason === 'exact-title')).toBe(true)
  expect(preview.changes.map(row => [row.localChapterId, row.eligible])).toEqual([['l79', true], ['l95', true], ['l179', true]])
})

it('目标标题仍含噪声标记时不算纯清理，不得自动应用', () => {
  // 反例：归一化不相等（`掉马推广` vs `掉马`），后端无法证明是同一标题。
  const preview = sourceSyncTestHelpers().buildPreview(
    [{ key: 's', order: 1, title: '掉马', url: '' }],
    [{ id: 'l', order: 1, title: '掉马（H）推广' }],
    metadata, true,
    { runId: 'not-noise-only', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  expect(preview.changes[0]?.eligible).toBe(false)
})

it.each([true, false])('源站推广尾巴不得自动写回干净标题（onlyWeakTitles=%s）', (onlyWeakTitles) => {
  const preview = sourceSyncTestHelpers().buildPreview(
    [{ key: 's', order: 1, title: '掉马po18.com', url: '' }],
    [{ id: 'l', order: 1, title: '掉马' }], metadata, onlyWeakTitles,
    { runId: 'promo-direction', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])
  expect(preview.changes).toHaveLength(1)
  expect(preview.changes[0]?.eligible).toBe(false)
})

it.each([
  ['第84章 掉马','掉马','import-prefix'],
  ['掉马po18.com','掉马','promo-cleanup'],
  ['掉马','掉马（微H）','rating-marker'],
  ['掉马，','掉马','typography'],
])('标题更新理由由服务端返回：%s → %s', (oldTitle,newTitle,reason) => {
  const preview = sourceSyncTestHelpers().buildPreview([{key:'s',order:1,title:newTitle,url:''}], [{id:'l',order:1,title:oldTitle}],metadata,true,
    {runId:'title-reasons',bindingId:'binding',novelId:'novel',site:'po18tw',sourceUrl:metadata.sourceUrl},[])
  expect(preview.changes[0]).toMatchObject({eligible:true,titleUpdateReasons:[reason]})
})

it('已对齐的同名章节无需序号修复，未匹配章不冒充占位阻塞源', () => {
  const titles = ['起点', '自由', '桥梁', '自由', '终点']
  const preview = sourceSyncTestHelpers().buildPreview(
    titles.map((title, i) => ({key: `s${i}`, order:i+1, title, url:''})),
    [...titles.map((title, i) => ({id:`l${i}`, order:i+1, title})), {id:'missing',order:6,title:'独立附记'}],
    metadata, true, {runId:'aligned-duplicates',bindingId:'binding',novelId:'novel',site:'po18tw',sourceUrl:metadata.sourceUrl}, [])
  expect(preview.orderChanges).toEqual([])
  expect(preview.orderRepairSkipped?.filter(row => ['l1','l3'].includes(row.localChapterId))).toEqual([])
  expect(preview.orderRepairBlockers).toEqual([])
  expect(preview.orderRepairBlockedReason).toBeUndefined()
  expect(preview.unmatchedLocal.map(row=>row.id)).toContain('missing')
})

it('拒绝旧预览中的反向广告自动更新，重新预览后未确认项保持原样', async () => {
  const novelId = 'legacy-promo-preview'
  await testDb.db.query('INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ($1,$2,$3,1,1)', [novelId,'测试书','作者'])
  await testDb.db.query('INSERT INTO chapters (id,novel_id,title,sort_order,word_count,created_at) VALUES ($1,$2,$3,1,0,1)', ['legacy-promo-chapter',novelId,'掉马'])
  const preview = await createSourceSyncPreview(testDb.db, {novelId,sourceUrl:'https://www.po18.tw/books/902326/articles',store:new PgScrapeStore(testDb.db),
    fetchHtml:async()=>({html:po18Directory([{order:1,title:'掉马po18.com'}]),encoding:'utf-8'})})
  // 目录提取器可能已经清理推广尾巴；直接模拟旧版本落库的建议验证应用边界。
  const legacyChanges = sourceSyncTestHelpers().buildPreview(
    [{key:'legacy-source',order:1,title:'掉马po18.com',url:''}],
    [{id:'legacy-promo-chapter',order:1,title:'掉马'}],metadata,true,
    {runId:preview.runId,bindingId:preview.bindingId,novelId,site:'po18tw',sourceUrl:metadata.sourceUrl},[]).changes
  expect(legacyChanges[0]?.eligible).toBe(false)
  await testDb.db.query('UPDATE source_sync_runs SET changes_json=$1 WHERE id=$2', [JSON.stringify(legacyChanges.map(change=>({...change,eligible:true}))),preview.runId])
  await expect(applySourceSync(testDb.db,{runId:preview.runId,confirmedChangeIds:['legacy-promo-chapter']})).rejects.toThrow('重新生成预览')
  await testDb.db.query('UPDATE source_sync_runs SET changes_json=$1 WHERE id=$2', [JSON.stringify(legacyChanges),preview.runId])
  expect(await applySourceSync(testDb.db,{runId:preview.runId})).toMatchObject({updated:0})
  const stored = await testDb.db.query<{title:string}>('SELECT title FROM chapters WHERE id=$1',['legacy-promo-chapter'])
  expect(stored.rows[0]?.title).toBe('掉马')
})

it.each([
  ['首长和太子', '84.首长和太子', '目标带导入前缀'],
  ['首长和太子', '第84章 首长和太子', '目标带「第N章」前缀'],
  ['40 38.我怎么可能会喜欢她', '38.我怎么可能会喜欢她', '两侧都带前缀'],
  ['掉马（H）推广', '掉马', '标题本身也变了'],
  ['被迫穿上情趣旗袍', '被迫穿上旗袍（微H）X', '标题正文被删改'],
])('反向护栏：本地「%s」→ 目标「%s」（%s）不得自动应用', (localTitle, sourceTitle, reason) => {
  expect(reason).toBeTruthy()
  const preview = sourceSyncTestHelpers().buildPreview(
    [{ key: 's', order: 1, title: sourceTitle, url: '' }],
    [{ id: 'l', order: 1, title: localTitle }],
    metadata, true,
    { runId: 'guard', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  for (const change of preview.changes) expect(change.eligible).toBe(false)
})

it('弱标题不因顺序推断而被自动改写', () => {
  // 纯分级标记「（H）」不承载标题信息，即使被顺序对齐也不能自动写入。
  const preview = sourceSyncTestHelpers().buildPreview(
    [{ key: 's', order: 1, title: 'H', url: '' }],
    [{ id: 'l', order: 1, title: '（H）' }],
    metadata, true,
    { runId: 'weak-eligible', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  expect(preview.mappings[0]?.matchReason).toBe('sequence')
  for (const change of preview.changes) expect(change.eligible).toBe(false)
})

it('两侧都带多层前缀时差异不是纯导入噪声，不得据此自动应用', () => {
  const source = [
    { key: 's1', order: 1, title: '38.我怎么可能会喜欢她', url: '' },
  ]
  const local = [
    { id: 'l1', order: 1, title: '40 38.我怎么可能会喜欢她' },
  ]
  const preview = sourceSyncTestHelpers().buildPreview(source, local, metadata, true,
    { runId: 'both-prefix', bindingId: 'binding', novelId: 'novel', site: 'po18tw', sourceUrl: metadata.sourceUrl }, [])

  expect(preview.mappings[0]).toMatchObject({ matchReason: 'exact-title', confidence: 'high' })
  const change = preview.changes[0]
  expect(change?.newTitle).toBe('38.我怎么可能会喜欢她')
  expect(change?.eligible).toBe(false)
})

describe('数值字段类型与快照往返一致性', () => {
  const source = [
    { order: 1, title: '教室里' },
    { order: 2, title: '失踪' },
    { order: 3, title: '笼子' },
    { order: 4, title: '浴室' },
  ]
  /**
   * 占位章 + 正文错位。真实书里链首被占位章卡住、缺口提供滑动启动位；
   * 这个小用例只验证"快照 order 始终是 number"这一类型契约。
   */
  async function seedShifted(novelId: string) {
    await testDb.db.query('INSERT INTO novels (id,title,author,created_at,updated_at) VALUES ($1,$1,\'作者\',1,1)', [novelId])
    const local = [
      { id: `${novelId}-junk`, title: '首-发：', order: 1 },
      { id: `${novelId}-n1`, title: '教室里', order: 2 },
      { id: `${novelId}-n2`, title: '失踪', order: 3 },
      { id: `${novelId}-n3`, title: '笼子', order: 5 },
      { id: `${novelId}-n4`, title: '浴室', order: 6 },
    ]
    for (const row of local) {
      await testDb.db.query('INSERT INTO chapters (id,novel_id,title,content,sort_order,created_at) VALUES ($1,$2,$3,\'正文保持\',$4,1)',
        [row.id, novelId, row.title, row.order])
    }
    return createSourceSyncPreview(testDb.db, {
      novelId, sourceUrl: 'https://www.po18.tw/books/902326/articles', store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({ html: po18Directory(source), encoding: 'utf-8' }),
    })
  }

  it('预览落库的快照 order 为数值，应用后仍为数值且不产生重复序号', async () => {
    const novelId = 'bigint-order-roundtrip'
    const preview = await seedShifted(novelId)

    const stored = await testDb.db.query<{ local_snapshot_json: string }>(
      'SELECT local_snapshot_json FROM source_sync_runs WHERE id=$1', [preview.runId])
    const snapshot = JSON.parse(stored.rows[0]!.local_snapshot_json)
    // 回归：pg 把 bigint 返回为字符串，未归一化会让段级分组静默退化。
    expect(snapshot.every((row: { order: unknown }) => typeof row.order === 'number')).toBe(true)

    const confirmed = preview.orderChanges.map(row => row.localChapterId)
    // repairOrder 仅在预览确有可修项时开启，否则 applySourceSync 会明确拒绝（无独立可修序号）。
    const result = await applySourceSync(testDb.db, {
      runId: preview.runId,
      repairOrder: preview.orderChanges.length > 0,
      confirmedOrderIds: confirmed,
    })
    // 应用条数必须与预览一致：两条路径不能各自算出不同的量。
    expect(result.orderUpdated).toBe(preview.orderChanges.length)

    const after = await testDb.db.query<{ sort_order: number }>('SELECT sort_order FROM chapters WHERE novel_id=$1', [novelId])
    const orders = after.rows.map(row => Number(row.sort_order))
    expect(new Set(orders).size).toBe(orders.length)

    const applied = await testDb.db.query<{ local_snapshot_json: string }>(
      'SELECT local_snapshot_json FROM source_sync_runs WHERE id=$1', [preview.runId])
    const appliedSnapshot = JSON.parse(applied.rows[0]!.local_snapshot_json)
    expect(appliedSnapshot.every((row: { order: unknown }) => typeof row.order === 'number')).toBe(true)
  })

  it('历史快照中 order 为字符串时能被归一化自愈', async () => {
    const novelId = 'legacy-string-order'
    const preview = await seedShifted(novelId)

    // 模拟历史脏数据：快照中的 order 全部是字符串（pg bigint 直返所致）。
    const stored = await testDb.db.query<{ local_snapshot_json: string }>(
      'SELECT local_snapshot_json FROM source_sync_runs WHERE id=$1', [preview.runId])
    const dirty = JSON.parse(stored.rows[0]!.local_snapshot_json).map((row: { id: string; title: string; order: number }) => ({ ...row, order: String(row.order) }))
    await testDb.db.query('UPDATE source_sync_runs SET local_snapshot_json=$1 WHERE id=$2', [JSON.stringify(dirty), preview.runId])

    // 读取侧归一化后仍能正常修复序号（脏数据不会让段级判定退化）。
    const healed = await refreshSourceSync(testDb.db, { runId: preview.runId, revision: 0 })
    expect(healed.orderShiftSegments).toBeDefined()
    // 归一化生效：所有段都基于数值 order 计算，偏移量不会是 NaN。
    expect(healed.orderShiftSegments!.every(row => Number.isFinite(row.offset))).toBe(true)
    // 与干净数据（未污染的原始快照）产出相同的段结构。
    expect(healed.orderShiftSegments!.map(row => [row.localRange.from, row.localRange.to, row.offset, row.kind]))
      .toEqual(preview.orderShiftSegments!.map(row => [row.localRange.from, row.localRange.to, row.offset, row.kind]))
  })
})
