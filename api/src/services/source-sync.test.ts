import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../test/db'
import { PgScrapeStore } from './scraper/store'
import {
  applySourceSync,
  createSourceSyncPreview,
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

function po18Directory(rows: Array<{ order: number; title: string }>): string {
  const chapters = rows
    .map(
      ({ order, title }) =>
        `<div class="c_l"><div class="l_counter">${String(order).padStart(4, '0')}</div><div class="l_chaptname"><a href="/books/902326/articles/${order}">${title}</a></div><div class="l_btn"><a href="/books/902326/articles/${order}">免費閱讀</a></div></div>`,
    )
    .join('')
  return `<html><head><title>本地书</title></head><body><div class="book_name">本地书</div>${chapters}</body></html>`
}

let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb()
  await testDb.applyMigrations()
})

afterAll(async () => {
  await testDb.close()
})

describe('source sync chapter mapping', () => {
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
