import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

  it('应用预览时只更新标题，并保存一对多映射', async () => {
    await testDb.db.query('INSERT INTO novels (id, title, author, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)', ['sync-novel', '本地书', '作者', 1])
    await testDb.db.query(
      `INSERT INTO chapters (id, novel_id, title, sort_order, word_count, created_at)
       VALUES ($1, $2, $3, $4, 0, 1), ($5, $2, $6, $7, 0, 1), ($8, $2, $9, $10, 0, 1)`,
      ['sync-a', 'sync-novel', '第12章（1/3）', 12, 'sync-b', '第12章（2/3）', 13, 'sync-c', '第12章（3/3）', 14],
    )
    const preview = await createSourceSyncPreview(testDb.db, {
      novelId: 'sync-novel',
      sourceUrl: 'https://example.com/book/12',
      manualTitles: ['第12章 暴雨'],
      store: new PgScrapeStore(testDb.db),
      fetchHtml: async () => ({ html: '<html><head><title>本地书</title></head><body><h1>本地书</h1></body></html>', encoding: 'utf-8' }),
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
})
