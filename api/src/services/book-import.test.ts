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

  it('derives the book title from a decorated export filename', () => {
    // 站点导出的文件名形如「[更73] 书名 作者：某某」，书名不该带上更新标记和署名。
    expect(helpers.fileStem('[更73] 和哥哥在乱交世界里假装do爱 作者：归雾.txt')).toBe('和哥哥在乱交世界里假装do爱')
    expect(helpers.fileStem('【完结】某某书 作者：张三.txt')).toBe('某某书')
    expect(helpers.fileStem('雾中书.txt')).toBe('雾中书')
  })

  it('matches a decorated title against the clean library title', () => {
    expect(helpers.titlesMatch('和哥哥在乱交世界里假装do爱', '[更73] 和哥哥在乱交世界里假装do爱 作者：归雾')).toBe(true)
    expect(helpers.titlesMatch('和哥哥在乱交世界里假装do爱', '和哥哥在乱交世界里假装do爱')).toBe(true)
    // 太短的包含关系不算同一本，避免单字书名把整库都匹配上。
    expect(helpers.titlesMatch('爱', '和哥哥在乱交世界里假装do爱')).toBe(false)
    expect(helpers.titlesMatch('魔王哥哥的千层馅饼', '和哥哥在乱交世界里假装do爱')).toBe(false)
  })

  it('picks the same book from the real library as a candidate', async () => {
    const libraryTitle = '和哥哥在乱交世界里假装do爱'
    const created = await testDb.db.query<{ id: string }>(
      `INSERT INTO novels (id, title, author, description, cover_url, categories, status, content_rating, source_url, chapter_count, created_at, updated_at)
       VALUES ('novel-target-1', $1, '归雾', '', '', '[]', 'ongoing', 'unknown', 'https://www.po18.tw/books/902326', 0, $2, $2) RETURNING id`,
      [libraryTitle, Date.now()],
    )
    const preview = await createPreview(testDb.db, {
      sourceType: 'file',
      sourceLabel: '[更73] 和哥哥在乱交世界里假装do爱 作者：归雾.txt',
      sourceUrl: '',
      payload: helpers.parseTextImport('第0001章 初见\n她推开门。\n第一章\n门开了。\n', '[更73] 和哥哥在乱交世界里假装do爱 作者：归雾.txt'),
    })

    expect(preview.book.title).toBe('和哥哥在乱交世界里假装do爱')
    expect(preview.candidates.map((candidate) => candidate.novel.id)).toContain(created.rows[0]!.id)
    // 唯一候选自动成为导入目标，增量导入才不会误建一本新书。
    expect(preview.targetNovelId).toBe('novel-target-1')
  })

  /**
   * 站点导出的 TXT 会在正文里重复一遍章节标题（章级「第0009章 标题」+ 正文首行「第九章」）。
   * 修复前：正文全挂到「第九章」上，抽出「第0009章」得到空正文。
   */
  it('merges the duplicated chapter heading instead of emitting empty chapters', () => {
    const text = [
      '第0001章\t初入',
      '',
      '    第一章',
      '    她推开门。',
      '',
      '第0002章\t夜行',
      '',
      '    第二章',
      '    风从窗外吹进来。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '两层标题.txt')

    expect(book.chapters).toHaveLength(2)
    expect(book.chapters.every((chapter) => chapter.content.trim().length > 0)).toBe(true)
    expect(book.chapters[0]?.title).toBe('第0001章\t初入')
    expect(book.chapters[0]?.content).toContain('第一章')
    expect(book.chapters[0]?.content).toContain('她推开门')
  })

  it('keeps volume headings inside the previous chapter body', () => {
    const book = helpers.parseTextImport('第一章 起\n正文甲。\n第三卷 风起\n第二章 承\n正文乙。', '卷标题.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 起', '第二章 承'])
    expect(book.chapters[0]?.content).toContain('正文甲')
    expect(book.chapters[0]?.content).toContain('第三卷 风起')
  })

  it('matches a volume-prefixed chapter heading to the plain one', () => {
    const book = helpers.parseTextImport('第49章 反击\n正文甲。\n第三卷 第49章 反击\n正文乙。', '卷内章节.txt')

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('正文甲')
    expect(book.chapters[0]?.content).toContain('正文乙')
  })

  /**
   * 站点导出常在同一份文件里混用三种标题写法：`第0001章 标题`、`32 标题`、`0073 标题`。
   * 只认「第NNN章」会让中段几十章整段丢失（实测 73 章的文件只解析出 34 章）。
   */
  it('accepts bare-number headings mixed with 第NNN章 headings', () => {
    const text = [
      '第0001章 起',
      '正文甲。',
      '2 她不想说话',
      '正文乙。',
      '003 我们走吧',
      '正文丙。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '混排.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第0001章 起', '2 她不想说话', '003 我们走吧'])
    expect(book.chapters.every((chapter) => chapter.content.trim().length > 0)).toBe(true)
  })

  it('does not split prose that merely starts with a number', () => {
    // 「第一回体验性爱……」是一句正文，不是标题；它曾把整章正文挂到自己名下。
    const prose = '第一回体验性爱就被内射，谢溪大脑空白了一瞬，身体也仿佛被置于一整片虚空之中，那东西粘稠湿润，热量惊人，浇在她最敏感的嫩肉上。'
    const book = helpers.parseTextImport(`第0001章 起\n${prose}\n正文继续。`, '长句.txt')

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('第一回体验性爱')
  })

  it('keeps a chapter whose in-body heading is misnumbered', () => {
    // 原文编号错位：`第0003章` 的正文首行写的是「第四章」，而真正的 `第0004章` 在其后。
    // 权威标题必须自成一章，否则第 3 章会被整章吞掉。
    const text = ['第0003章 甲', '第四章', '正文甲。', '第0004章 乙', '正文乙。'].join('\n')
    const book = helpers.parseTextImport(text, '错位.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第0003章 甲', '第0004章 乙'])
    expect(book.chapters[0]?.content).toContain('正文甲')
    expect(book.chapters[1]?.content).toContain('正文乙')
  })

  it('still treats plain 第一章 / 第二章 files as separate chapters', () => {
    // 这类文件没有「第NNN章」权威标题，中文数字标题就是真正的章节边界。
    const book = helpers.parseTextImport('第一章 初见\n她推开门。\n第二章 夜行\n风从窗外吹进来。', '纯中文数字.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第一章 初见', '第二章 夜行'])
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
