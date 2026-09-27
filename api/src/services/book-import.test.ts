import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Novel } from '@shared/types'
import { createTestDb, type TestDb } from '../test/db'
import { applyImport, bookImportTestHelpers, createPreview, rollbackImport, type StoredImportRun } from './book-import'

const helpers = bookImportTestHelpers()
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb()
  await testDb.applyMigrations()
})

afterAll(async () => {
  await testDb.close()
})

describe('book import normalization and diffing', () => {
  it('parses numbered TXT chapters into the common payload', () => {
    const book = helpers.parseTextImport('第一章 初见\n她推开门。\n\n第二章 夜行\n风从窗外吹进来。', '雾中书.txt')

    expect(book.title).toBe('雾中书')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 初见', '第二章 夜行'])
    expect(book.chapters[0]?.content).toContain('她推开门')
  })

  it('only removes formatting noise from title matching', () => {
    expect(helpers.normalizeImportTitle('《  星河-旧梦 》')).toBe('星河旧梦')
    expect(helpers.normalizeImportTitle('星河旧梦')).toBe('星河旧梦')
    expect(helpers.normalizeImportChapterTitle('第 12 章 归途')).toBe('归途')
  })

  it('classifies new, unchanged, changed and ambiguous chapters', () => {
    const chapters = helpers.buildChapterDiff(
      {
        title: '测试书',
        author: '作者',
        chapters: [
          { title: '第一章', order: 1, content: '旧内容' },
          { title: '第二章', order: 2, content: '新内容' },
          { title: '第三章', order: 3, content: '新增内容' },
          { title: '番外', order: 4, content: '有歧义' },
        ],
      },
      [
        { id: 'one', title: '第一章', sort_order: 1, content: '旧内容', source_url: '' },
        { id: 'two', title: '第二章', sort_order: 2, content: '旧版本', source_url: '' },
        { id: 'extra-a', title: '番外', sort_order: 8, content: 'A', source_url: '' },
        { id: 'extra-b', title: '番外', sort_order: 9, content: 'B', source_url: '' },
      ],
    )

    expect(chapters.map((chapter) => chapter.status)).toEqual(['unchanged', 'changed', 'new', 'conflict'])
    expect(chapters[0]?.selected).toBe(false)
    expect(chapters[2]?.selected).toBe(true)
    expect(chapters[3]?.selected).toBe(false)
  })

  it('selects only missing metadata by default', () => {
    const novel = {
      id: 'novel-1',
      title: '测试书',
      author: '作者',
      description: '',
      coverUrl: '',
      categories: [],
      status: 'ongoing',
      contentRating: 'unknown',
      sourceUrl: '',
      chapterCount: 1,
      remoteChapterCount: 0,
      updateCheckedAt: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Novel
    const diffs = helpers.buildMetadataDiff(
      { title: '测试书', author: '新作者', description: '简介', categories: ['都市'], chapters: [{ title: '一', order: 1, content: '正文' }] },
      novel,
    )

    expect(diffs.find((diff) => diff.field === 'description')).toMatchObject({ changed: true, selected: true })
    expect(diffs.find((diff) => diff.field === 'author')).toMatchObject({ changed: true, selected: false })
  })

  it('applies a new-book import and rolls back only its recorded changes', async () => {
    const payload = {
      title: '可撤回的测试书',
      author: '测试作者',
      description: '导入简介',
      chapters: [
        { title: '第一章', order: 1, content: '第一章正文足够长，用来验证导入和撤回。' },
        { title: '第二章', order: 2, content: '第二章正文足够长，用来验证章节快照。' },
      ],
    }
    const preview = await createPreview(testDb.db, {
      sourceType: 'file',
      sourceLabel: '可撤回的测试书.txt',
      sourceUrl: '',
      payload,
    })
    await testDb.db.query(
      `INSERT INTO book_import_runs
        (id, actor_user_id, source_type, source_label, source_url, target_novel_id, status, payload_json, preview_json, changes_json, created_at, applied_at, rolled_back_at)
       VALUES ($1,'test','file',$2,'','', 'preview',$3,$4,'[]',$5,0,0)`,
      [preview.runId, preview.sourceLabel, JSON.stringify(payload), JSON.stringify(preview), Date.now()],
    )
    const run: StoredImportRun = {
      id: preview.runId,
      source_type: 'file',
      source_label: preview.sourceLabel,
      source_url: '',
      target_novel_id: '',
      status: 'preview',
      payload_json: JSON.stringify(payload),
      preview_json: JSON.stringify(preview),
      changes_json: '[]',
      created_at: Date.now(),
      applied_at: 0,
      rolled_back_at: 0,
    }
    const result = await applyImport(testDb.db, {
      run,
      selectedChapterIds: preview.chapters.filter((chapter) => chapter.selected).map((chapter) => chapter.id),
      metadataFields: preview.metadataDiff.filter((field) => field.selected).map((field) => field.field),
      metadataMode: 'missing',
      actorUserId: 'test',
    })

    expect(result.novelCreated).toBe(true)
    expect(result.created).toBe(2)
    const imported = await testDb.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM novels WHERE id = $1', [result.novelId])
    const importedChapters = await testDb.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM chapters WHERE novel_id = $1', [result.novelId])
    expect(imported.rows[0]?.count).toBe(1)
    expect(importedChapters.rows[0]?.count).toBe(2)

    const stored = await testDb.db.query<StoredImportRun>('SELECT * FROM book_import_runs WHERE id = $1', [preview.runId])
    const rollback = await rollbackImport(testDb.db, stored.rows[0]!)
    expect(rollback.conflicts).toHaveLength(0)
    expect(rollback.rolledBack).toBe(3)
    const afterRollback = await testDb.db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM novels WHERE id = $1', [result.novelId])
    expect(afterRollback.rows[0]?.count).toBe(0)
  })
})
