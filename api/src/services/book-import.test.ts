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

  /**
   * 增量导入的关键前提：导入侧的裸数字标题必须与库里「不带编号的章节名」算同一章。
   * 库里的 title 存的是「她才不想要呢……【400珠加更】」，导入侧是「32 她才不想要呢……【400珠加更】」；
   * 若编号前缀不参与归一化，两边的键永远不同，`43` 个已存在章节会被整片误判成新增。
   */
  it('matches a bare-number chapter to the same local chapter title', () => {
    expect(helpers.normalizeImportChapterTitle('32 她才不想要呢……【400珠加更】')).toBe(
      helpers.normalizeImportChapterTitle('她才不想要呢……【400珠加更】'),
    )
    expect(helpers.normalizeImportChapterTitle('0073 我们做夫妻也是可以的【2500珠加更】')).toBe(
      helpers.normalizeImportChapterTitle('我们做夫妻也是可以的【2500珠加更】'),
    )

    // 端到端：本地已有该章时不能再报「新增」。
    // 标题字面不同（导入侧带编号）会判为「有变化」——这正是需要人工确认的增量，
    // 但绝不能是「新增」，否则同一章会被重复插一份。
    const book = helpers.parseTextImport('32 她才不想要呢……【400珠加更】\n同一段正文。', '裸数字.txt')
    const diff = helpers.buildChapterDiff(book, [
      { id: 'ch-32', title: '她才不想要呢……【400珠加更】', sort_order: 32, content: '同一段正文。', source_url: '' },
    ])

    expect(diff.map((chapter) => chapter.status)).toEqual(['changed'])
    expect(diff[0]?.localChapterId).toBe('ch-32')
    expect(diff[0]?.status).not.toBe('new')
  })

  it('strips a dotted inner number from double-numbered headings', () => {
    // 站点导出把「外层编号 + 内层编号」都写进标题：「第0001章\t1.霸凌高冷学霸蹭逼喝尿（h）」。
    // 早期只剥「编号 + 空白」，内层「1.」的数字残留成「1霸凌…」，与库里的「霸凌…」
    // 永不相等，整份文件的章节都会被误判成新增。实测 58 章全部受影响。
    expect(helpers.normalizeImportChapterTitle('第0001章\t1.霸凌高冷学霸蹭逼喝尿（h）')).toBe(
      helpers.normalizeImportChapterTitle('霸凌高冷学霸蹭逼喝尿（h）'),
    )
    expect(helpers.normalizeImportChapterTitle('1.霸凌高冷学霸蹭逼喝尿（h）')).toBe(
      helpers.normalizeImportChapterTitle('霸凌高冷学霸蹭逼喝尿（h）'),
    )
    // 外层与内层编号叠加（`19 18.标题`）。
    expect(helpers.normalizeImportChapterTitle('19 18.想吃鸡巴就吃成这样（h）（加更）')).toBe(
      helpers.normalizeImportChapterTitle('想吃鸡巴就吃成这样（h）（加更）'),
    )
    // 纯编号无标题文本时也要能对上。
    expect(helpers.normalizeImportChapterTitle('30.有情人终成兄妹')).toBe(
      helpers.normalizeImportChapterTitle('有情人终成兄妹'),
    )
    // 正文里的年份与小数不能被削掉半截。
    expect(helpers.normalizeImportChapterTitle('1999年的夏天')).toContain('1999')
    expect(helpers.normalizeImportChapterTitle('12.5公里的路')).toContain('12')
    expect(helpers.normalizeImportChapterTitle('12.5公里的路')).not.toBe(helpers.normalizeImportChapterTitle('5公里的路'))
  })

  it('does not split prose that merely starts with a number', () => {
    // 「第一回体验性爱……」是一句正文，不是标题；它曾把整章正文挂到自己名下。
    const prose = '第一回体验性爱就被内射，谢溪大脑空白了一瞬，身体也仿佛被置于一整片虚空之中，那东西粘稠湿润，热量惊人，浇在她最敏感的嫩肉上。'
    const book = helpers.parseTextImport(`第0001章 起\n${prose}\n正文继续。`, '长句.txt')

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('第一回体验性爱')
  })

  it('splits bare-number headings written without a space', () => {
    // 真实导出：前 31 章是「第0031章 标题」，之后切换成紧贴写法「32标题」「0080标题」。
    // 早期裸数字规则要求数字后必须有空格，导致整份文件只切出 45 章（真实 90 章）。
    const text = [
      '第0031章\t「哥哥是我的。」',
      '正文甲。',
      '32她才不想要呢……【400珠加更】',
      '正文乙。',
      '0080一个小调查',
      '正文丙。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '紧贴裸数字.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      '第0031章\t「哥哥是我的。」',
      '32 她才不想要呢……【400珠加更】',
      '0080 一个小调查',
    ])
    expect(book.chapters.every((chapter) => chapter.content.trim().length > 0)).toBe(true)
  })

  it('does not split tight prose that starts with a number', () => {
    // 「69是什么，她之前其实没有听过。」以数字紧贴中文开头，长度与句读都不满足标题约束。
    const book = helpers.parseTextImport(
      ['第0001章 起', '正文甲。', '69是什么，她之前其实没有听过。', '正文乙。'].join('\n'),
      '紧贴正文.txt',
    )

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('69是什么，她之前其实没有听过。')
  })

  it('does not split a year or large number at line start', () => {
    // 四位以上数字（年份/珠数）不参与裸数字切分。
    const book = helpers.parseTextImport(
      ['第0001章 起', '正文甲。', '2016年发布的番外，与正文无关。', '1200珠加更已补齐。'].join('\n'),
      '年份.txt',
    )

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('2016年发布')
    expect(book.chapters[0]?.content).toContain('1200珠加更')
  })

  it('does not split forum floor markers into chapters', () => {
    // 站点把「论坛番外」导出成 TXT 时，楼层退化成紧贴的「编号 + 楼」，
    // 天然符合裸数字章节的形状。实测一份 59 章的文件因此多出 46 个幽灵章节。
    const text = [
      '38  36.5 论坛番外（非男主意淫预警）',
      '匿名',
      '1楼',
      '怎么校内论坛也能刷到短剧剧情，楼主拿的是不是炮灰',
      '2楼楼主',
      '何意味。本少爷怎么着也得是个男二吧?',
      '6楼:所以楼主被扇了吗?那位的巴掌香不香软不软?',
      '39 37.蓄意讨赏',
      '正文甲。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '论坛番外.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      '38 36.5 论坛番外（非男主意淫预警）',
      '39 37.蓄意讨赏',
    ])
    // 楼层内容必须完整留在论坛番外章内。
    expect(book.chapters[0]?.content).toContain('2楼楼主')
    expect(book.chapters[0]?.content).toContain('6楼:所以楼主被扇了吗')
  })

  it('keeps a chapter title that merely starts with 楼', () => {
    // 楼层识别只认「楼」「楼楼主」「楼:」三种形态，不能误伤以「楼」开头的真实章名。
    const book = helpers.parseTextImport(
      ['12楼上的秘密', '正文甲。', '第0013章 收尾', '正文乙。'].join('\n'),
      '楼开头.txt',
    )

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['12 楼上的秘密', '第0013章 收尾'])
  })

  it('does not treat a zero-prefixed prose line as a chapter', () => {
    // 章节号从 1 开始；「0个人问你脸和身材」是网络语正文（0 个人 = 没有人），
    // 不是第 0 章。它曾把一个楼层回复切成独立章节。
    const book = helpers.parseTextImport(
      ['第0023章 起', '正文甲。', '0个人问你脸和身材', '正文乙。'].join('\n'),
      '零开头.txt',
    )

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('0个人问你脸和身材')
  })

  it('keeps a short chapter title ending with an ellipsis', () => {
    // `第0006章 傅哥哥，疼……` 是真实章名，以省略号收尾。早期把「句号/省略号收尾」
    // 一律判为正文，导致该章整章丢失。正文长句同时满足「句读收尾」与「超长」，
    // 短标题不会，故按长度区分。
    const book = helpers.parseTextImport(
      ['第0005章 起', '正文甲。', '第0006章 傅哥哥，疼……', '正文乙。', '第0007章 续', '正文丙。'].join('\n'),
      '省略号标题.txt',
    )

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第0005章 起', '第0006章 傅哥哥，疼……', '第0007章 续'])
  })

  it('does not split an indented prose line that starts with a number', () => {
    // 紧贴写法没有分隔符，歧义最大：标题在行首，正文段落才带缩进。
    // 「117」是本书系统名，正文里「117骗了她！」这类句子都带缩进。
    const text = [
      '第0117章 世界三',
      '正文甲。',
      '     117骗了她！',
      '     117有点慌，这么不靠谱，不能出什么岔子吧？',
      '　　117简直目瞪口呆，它怎么没发现它家宿主这么会乱想？',
      '正文乙。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '缩进正文.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第0117章 世界三'])
    expect(book.chapters[0]?.content).toContain('117骗了她！')
    expect(book.chapters[0]?.content).toContain('117简直目瞪口呆')
  })

  it('does not split a numbered list item or a quantity into chapters', () => {
    // 站点导出的排雷清单用「编号 + 冒号」，正文里的数量写作「数字 + 万/%」。
    // 二者都天然符合裸数字标题的形状。
    const text = [
      '书名：测试书',
      '作者：某人',
      '【排雷必看】',
      '1：男强女弱，女主性格真的很软很容易被欺负。',
      '2：男女双C，快穿世界无逻辑，一切剧情为H服务，（全文h无套，默认不会怀孕）',
      '第0001章 起',
      '正文甲。',
      '     1万点积分？她任务完成了？积分也够了？',
      '     99%了，只差临门一脚，她就完成这个世界的攻略了！',
      '　　4:默认男主已结扎！！！',
      '正文乙。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '排雷清单.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第0001章 起'])
    expect(book.chapters[0]?.content).toContain('1万点积分')
    expect(book.chapters[0]?.content).toContain('99%了')
    expect(book.chapters[0]?.content).toContain('4:默认男主已结扎')
  })

  it('drops site front matter that precedes the first chapter heading', () => {
    // 首个章节标题之前的宣传位（「点击直达……」「连载文:」）不是章节，
    // 不应变成名为「正文」的伪章。前提是文件确实存在章节标题。
    const text = [
      '书名：测试书',
      '作者：某人',
      '点击直达……',
      '连载文:',
      '《你要不要和我做爱》校园1v1',
      '第0001章 起',
      '正文甲。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '前置宣传.txt')

    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['第0001章 起'])
    expect(book.title).toBe('测试书')
  })

  it('keeps the whole text as one chapter when no heading exists at all', () => {
    // 无任何章节标题的纯文本文件：首块就是正文本身，不能当站点前置信息丢掉。
    const text = ['书名：测试书', '作者：某人', '', '她推开门，看见了他。', '风从窗外吹进来。'].join('\n')
    const book = helpers.parseTextImport(text, '纯文本.txt')

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0]?.content).toContain('她推开门，看见了他。')
  })

  it('does not delete a body line that also appears in the synopsis', () => {
    // 简介里的句子常与正文原句重合（实测「镇子上闹妖魔，两个仙君远道而来。」既在简介
    // 又在第 1 章正文）。早期实现把已消费的元信息行按文本从各章正文里摘除，
    // 结果正文那处被连带删掉，静默少了一句。元信息提取必须只读不改。
    const text = [
      '书名：测试书',
      '作者：某人',
      '简介：她第一次看见仙君。',
      '镇子上闹妖魔，两个仙君远道而来。',
      '',
      '第0001章 起',
      '她第一次看见仙君。',
      '镇子上闹妖魔，两个仙君远道而来。',
      '一人着红衣，一人着白衣。',
    ].join('\n')
    const book = helpers.parseTextImport(text, '简介重合.txt')

    expect(book.description).toContain('镇子上闹妖魔')
    expect(book.chapters).toHaveLength(1)
    // 正文两句都必须还在，且顺序不变。
    expect(book.chapters[0]?.content).toContain('她第一次看见仙君。')
    expect(book.chapters[0]?.content).toContain('镇子上闹妖魔，两个仙君远道而来。')
    expect(book.chapters[0]?.content).toContain('一人着红衣，一人着白衣。')
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
