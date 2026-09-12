/**
 * writing.ts 纯函数单测：续写输出的首行标题解析。
 * generateWriting 本身走 AI/DB，这里只测可测的 parseContinuationTitle。
 */
import { describe, it, expect } from 'vitest'
import { cleanWritingTail, formatWritingBrief, parseContinuationTitle, parsePlotSuggestions, splitOutlineByChapter, validateWritingBrief } from './writing'

describe('splitOutlineByChapter', () => {
  it('按「第N章」切分，每章只取自己的段落', () => {
    const outline = '第1章 重返皇城\n苏越带夭夜入城，面见加刑天。\n第2章 婚夜\n两人在寝宫独处，约定共进退。\n第3章 战云压境\n云山率众陈兵城下。'
    const sections = splitOutlineByChapter(outline, 3)
    expect(sections).toHaveLength(3)
    expect(sections[0]).toContain('重返皇城')
    expect(sections[0]).not.toContain('婚夜')
    expect(sections[1]).toContain('两人在寝宫独处')
    expect(sections[1]).not.toContain('云山')
    expect(sections[2]).toContain('云山率众陈兵城下')
  })

  it('支持中文数字与阿拉伯数字加顿号两种标记', () => {
    const cn = splitOutlineByChapter('第一章 起\n甲。\n第二章 承\n乙。', 2)
    expect(cn[0]).toContain('甲')
    expect(cn[1]).toContain('乙')
    const ar = splitOutlineByChapter('1、起\n甲。\n2、承\n乙。', 2)
    expect(ar[0]).toContain('甲')
    expect(ar[1]).toContain('乙')
  })

  it('支持「第十一章」这类复合中文数字', () => {
    const sections = splitOutlineByChapter('第十一章 转折\n丙。\n第十二章 收束\n丁。', 12)
    expect(sections[10]).toContain('丙')
    expect(sections[11]).toContain('丁')
  })

  it('章节标记前的前言并入第 1 章', () => {
    const sections = splitOutlineByChapter('本卷主线是苏越与夭夜的结盟。\n第1章 起\n甲。\n第2章 承\n乙。', 2)
    expect(sections[0]).toContain('本卷主线')
    expect(sections[0]).toContain('起')
    expect(sections[0]).toContain('甲')
    // 标记行里的标题文字保留在该章内，不与上章混在一起
    expect(sections[0]).not.toContain('乙')
    expect(sections[1]).toBe('承\n乙。')
  })

  it('缺失章节返回空串，由调用方决定是否回退', () => {
    const sections = splitOutlineByChapter('第1章 起\n甲。\n第3章 转\n丙。', 3)
    expect(sections[1]).toBe('')
    expect(sections[2]).toContain('丙')
  })

  it('容忍 Markdown 标题前缀（模型常输出「## 第1章 ...」）', () => {
    const outline = '## 第1章 起\n甲。\n\n## 第2章 承\n乙。\n\n### 第3章 转\n丙。'
    const sections = splitOutlineByChapter(outline, 3)
    expect(sections).toHaveLength(3)
    expect(sections[0]).toContain('甲')
    expect(sections[1]).toContain('乙')
    expect(sections[2]).toContain('丙')
    // 标题行本身不该混进上一章
    expect(sections[0]).not.toContain('乙')
  })

  it('识别不出章节标记时返回空数组', () => {
    expect(splitOutlineByChapter('写一段轻松的日常，交代两人关系。', 3)).toEqual([])
    expect(splitOutlineByChapter('', 3)).toEqual([])
  })
})

describe('parsePlotSuggestions', () => {
  it('解析 JSON 对象数组，保留 direction 与 effect', () => {
    const text = '[{"direction":"苏越带夭夜入密室双修，借双修商定应对云岚宗的部署。","effect":"修为突破并定下战局立场"},{"direction":"夭夜在朝堂与云山使者对峙。","effect":"势力冲突升级"}]'
    const out = parsePlotSuggestions(text)
    expect(out).toHaveLength(2)
    expect(out[0]!.direction).toContain('双修')
    expect(out[0]!.effect).toContain('修为突破')
    expect(out[1]!.direction).toContain('朝堂')
  })

  it('容忍纯字符串数组', () => {
    const out = parsePlotSuggestions('["苏越与夭夜在婚房独处一晚。","蛇人族使者抵达皇都。"]')
    expect(out).toHaveLength(2)
    expect(out[0]!.direction).toContain('婚房')
  })

  it('模型返回行列表时剥离序号与项目符号', () => {
    const text = '1. 苏越与夭夜在婚房独处，写一场完整的洞房戏。\n2. 美杜莎突然现身皇都，带来魂殿的消息。\n- 夭夜独自领兵迎敌，苏越暗中相护。'
    const out = parsePlotSuggestions(text)
    expect(out).toHaveLength(3)
    expect(out[0]!.direction.startsWith('1.')).toBe(false)
    expect(out[0]!.direction).toContain('洞房戏')
    expect(out[2]!.direction.startsWith('-')).toBe(false)
  })

  it('忽略空行、纯符号行与过短内容', () => {
    const out = parsePlotSuggestions('\n\n[ ]\n\n嗯\n\n苏越带夭夜返回乌坦城探访萧家旧宅，交代萧炎的近况。\n')
    expect(out).toHaveLength(1)
    expect(out[0]!.direction).toContain('乌坦城')
  })

  it('最多返回 6 条，空输入返回空数组', () => {
    expect(parsePlotSuggestions('')).toEqual([])
    const many = Array.from({ length: 9 }, (_, i) => `方向内容足够长的一条候选描述${i}。`).join('\n')
    expect(parsePlotSuggestions(many).length).toBeLessThanOrEqual(6)
  })
})

describe('writingBrief', () => {
  it('规范化字段、按批次序号排序，并按 Unicode 标量限制长度', () => {
    const result = validateWritingBrief(
      {
        version: 1,
        viewpoint: '第三人称限知',
        pace: '舒缓',
        objective: '发现矛盾',
        requiredFacts: '伤势仍未痊愈',
        forbiddenEvents: '不得揭露幕后人物',
        chapterGoals: [{ index: 2, goal: '收束线索' }, { index: 1, goal: '发现证词矛盾' }],
      },
      2,
    )
    expect(result.error).toBeUndefined()
    expect(result.brief?.chapterGoals).toEqual([
      { index: 1, goal: '发现证词矛盾' },
      { index: 2, goal: '收束线索' },
    ])
  })

  it('拒绝版本、字段类型、重复或越界目标，以及单字段/总长度超限', () => {
    expect(validateWritingBrief({ version: 2 }, 1).error).toContain('version')
    expect(validateWritingBrief({ version: 1, pace: 1 }, 1).error).toContain('pace')
    expect(validateWritingBrief({ version: 1, chapterGoals: [{ index: 1, goal: 'a' }, { index: 1, goal: 'b' }] }, 1).error).toContain('不能重复')
    expect(validateWritingBrief({ version: 1, chapterGoals: [{ index: 2, goal: 'a' }] }, 1).error).toContain('范围')
    expect(validateWritingBrief({ version: 1, viewpoint: '🙂'.repeat(201) }, 1).error).toContain('viewpoint')
    expect(validateWritingBrief({ version: 1, viewpoint: 'v'.repeat(200), pace: 'p'.repeat(200), objective: 'a'.repeat(1000), requiredFacts: 'b'.repeat(3000), forbiddenEvents: 'c'.repeat(3000), chapterGoals: [1, 2, 3, 4, 5].map((index) => ({ index, goal: 'd'.repeat(1000) })) }, 5).error).toContain('总长度')
  })

  it('按结构化要求、对应章节目标、补充要求的固定顺序格式化', () => {
    const brief = validateWritingBrief({ version: 1, viewpoint: '第一人称', pace: '紧凑', chapterGoals: [{ index: 2, goal: '第二章目标' }] }, 2).brief!
    const formatted = formatWritingBrief(brief, 2)
    expect(formatted.structured.indexOf('叙事视角')).toBeLessThan(formatted.structured.indexOf('节奏'))
    expect(formatted.goal).toContain('第二章目标')
    expect(formatWritingBrief(brief, 1).goal).toBe('')
  })
})

describe('cleanWritingTail', () => {
  it('保留清洗后正文的末尾哨兵，而不是前缀', () => {
    const source = `${'前文。'.repeat(3000)}唯一的章节结尾哨兵。`
    const tail = cleanWritingTail(source, 32)
    expect(tail).toContain('唯一的章节结尾哨兵。')
    expect(tail.endsWith('唯一的章节结尾哨兵。')).toBe(true)
    expect(tail.length).toBeLessThanOrEqual(32)
  })
})

describe('parseContinuationTitle', () => {
  it('识别「标题：xxx」前缀并剥离标题行', () => {
    const parsed = parseContinuationTitle('标题：雨夜断剑\n\n少年在雨夜捡到一柄断剑。\n他攥紧了剑柄。')
    expect(parsed.title).toBe('雨夜断剑')
    expect(parsed.body).toBe('少年在雨夜捡到一柄断剑。\n他攥紧了剑柄。')
  })

  it('识别「章节标题:」与「Title:」前缀（大小写不敏感）', () => {
    expect(parseContinuationTitle('章节标题: 巷口灯笼\n\n正文开始。').title).toBe('巷口灯笼')
    expect(parseContinuationTitle('Title: The Rainy Night\n\nBody here.').title).toBe('The Rainy Night')
  })

  it('识别 # 与《》包裹的首行标题', () => {
    expect(parseContinuationTitle('# 雨夜断剑\n\n正文开始。').title).toBe('雨夜断剑')
    expect(parseContinuationTitle('《雨夜断剑》\n\n正文开始。').title).toBe('雨夜断剑')
  })

  it('识别裸首行标题：2-30 字、不以句末标点结尾、其后有空行', () => {
    const parsed = parseContinuationTitle('雨夜断剑\n\n少年在雨夜捡到一柄断剑。')
    expect(parsed.title).toBe('雨夜断剑')
    expect(parsed.body).toBe('少年在雨夜捡到一柄断剑。')
  })

  it('清洗标题包裹符号并截断到 40 字', () => {
    expect(parseContinuationTitle('标题：「雨夜断剑」\n\n正文。').title).toBe('雨夜断剑')
    const longTitle = '标题：' + '长'.repeat(50) + '\n\n正文。'
    expect(parseContinuationTitle(longTitle).title).toHaveLength(40)
  })

  it('以句末标点结尾的首行不是裸标题，原样返回', () => {
    const text = '少年在雨夜捡到一柄断剑，被巡夜人盯上。\n\n他攥紧了剑柄。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('首行后无空行时不当作裸标题，原样返回', () => {
    const text = '雨夜断剑\n少年在雨夜捡到一柄断剑。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('空输入 / 空首行返回空标题与原文', () => {
    expect(parseContinuationTitle('')).toEqual({ title: '', body: '' })
    expect(parseContinuationTitle('\n\n正文。')).toEqual({ title: '', body: '正文。' })
  })

  it('兼容 CRLF 换行', () => {
    const parsed = parseContinuationTitle('标题：雨夜断剑\r\n\r\n少年在雨夜捡到一柄断剑。')
    expect(parsed.title).toBe('雨夜断剑')
    expect(parsed.body).toBe('少年在雨夜捡到一柄断剑。')
  })

  // —— 以下是自定义提示词下模型实际产出过的格式（2026-08-16 线上数据） ——

  it('章节号行不是标题：跳过「第 88 章」取下一行的【标题】', () => {
    const parsed = parseContinuationTitle('第 88 章\n【哥哥未说出口的话】HH\n\n第二天早上我是被热醒的。')
    expect(parsed.title).toBe('哥哥未说出口的话 HH')
    expect(parsed.body).toBe('第二天早上我是被热醒的。')
  })

  it('跳过带 # 前缀的章节号行（## 第 6 章）', () => {
    const parsed = parseContinuationTitle('## 第 6 章\n【哥哥午后的画框】HHH\n\n浴室门打开的时候。')
    expect(parsed.title).toBe('哥哥午后的画框 HHH')
    expect(parsed.body).toBe('浴室门打开的时候。')
  })

  it('章节号行自带尾巴时尾巴是标题：「第 3 章 锁孔里的光」', () => {
    const parsed = parseContinuationTitle('第 3 章 锁孔里的光\n\n正文开始。')
    expect(parsed.title).toBe('锁孔里的光')
    expect(parsed.body).toBe('正文开始。')
  })

  it('无章节号行时识别【标题】HH 并保留 H 评级标记', () => {
    const parsed = parseContinuationTitle('【旧账与往事】HH\n\n我整个人是被钉在床沿的。')
    expect(parsed.title).toBe('旧账与往事 HH')
    expect(parsed.body).toBe('我整个人是被钉在床沿的。')
  })

  it('章节号行后没有标题行时原样返回，不误剥正文', () => {
    const text = '第 88 章\n\n第二天早上我是被热醒的。\n\n他攥紧了剑柄。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('全文任意位置有空行但标题行后无空行时，不当作裸标题', () => {
    const text = '雨夜断剑少年拾起断剑\n他攥紧了剑柄。\n\n次日清晨。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('剥离后正文为空时不当作标题行（如单行短文本），原样返回', () => {
    expect(parseContinuationTitle('第一章开篇之也')).toEqual({ title: '', body: '第一章开篇之也' })
    expect(parseContinuationTitle('【笼中雀】')).toEqual({ title: '', body: '【笼中雀】' })
  })

  // 线上真实失败样本（2026-09-12 十连续写第 5 章）：模型直接从叙述句开写，未输出标题行。
  // 此处必须解析为空标题，交由 generateWriting 的补拟分支处理，而不是把正文首句误当标题剥掉。
  it('模型漏输出标题行时返回空标题，不误剥正文首句', () => {
    const text = [
      '魂渊遁走，皇都上空的浓云散了大半，露出久违的日光。可那日光落在满城碎裂的砖瓦与倒伏的旗帜上，无人觉得温暖。',
      '',
      '苏越靠在夭夜肩头歇了片刻，体内生生不息运转，斗气每十秒便恢复一大截。',
      '',
      '“夜儿，清点伤亡。”',
    ].join('\n')
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('以句末标点结尾的短首行仍不当作裸标题', () => {
    const text = '他赢了。\n\n众人沉默了很久。'
    expect(parseContinuationTitle(text)).toEqual({ title: '', body: text })
  })

  it('识别单次输出中混入的第二章标题', () => {
    const parsed = parseContinuationTitle('【笼门】HHHH\n\n第一章正文。\n\n【心甘情愿】HHH\n\n第二章正文。')
    expect(parsed.body).toBe('第一章正文。')
  })
})
