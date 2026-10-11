import { expect, it } from 'vitest'
import { boundaryImpacts } from './book-import-state'
import type { StoredImportRun } from './book-import'

function run(source: string): StoredImportRun {
  return { source_text: source, source_label: '样本.txt', source_expires_at: 0 } as StoredImportRun
}

it('误识别后被丢弃的空章节标题改为正文时，明确返回归属与新增文字', () => {
  const note = '100珠的加更送上啦，感谢投珠支持的宝贝们'
  const content = ['第21章 夜雨', '原有正文。', note, '第22章 清晨', '第二章正文。'].join('\n')
  const [impact] = boundaryImpacts(
    run(content),
    [{ line: 3, verdict: 'heading', source: 'manual', updatedAt: 1 }],
    [{ line: 3, verdict: 'prose', source: 'manual', updatedAt: 2 }],
  )
  expect(impact?.change).toMatchObject({ beforeRole: 'heading', afterRole: 'prose', addedText: note, addedChars: 21, removedText: '', removedChars: 0 })
  expect(impact?.context).toEqual([
    { line: 1, raw: '第21章 夜雨' },
    { line: 2, raw: '原有正文。' },
    { line: 3, raw: note },
    { line: 4, raw: '第22章 清晨' },
    { line: 5, raw: '第二章正文。' },
  ])
})

it('正文切出新章展示两边所有相关章节，不能把两个不同章节字数当成增减', () => {
  const [impact] = boundaryImpacts(
    run(['第1章 起', '前段正文。', '尾声', '尾声正文。'].join('\n')),
    [],
    [{ line: 3, verdict: 'heading', source: 'manual', updatedAt: 1 }],
  )
  expect(impact?.change).toMatchObject({ beforeRole: 'prose', afterRole: 'heading' })
  expect(impact?.change?.addedChars).toBeUndefined()
  expect(impact?.before.chapters?.map((chapter) => chapter.title)).toEqual(['第1章 起'])
  expect(impact?.after.chapters?.map((chapter) => chapter.title)).toEqual(['第1章 起', '尾声'])
})

it('取消真实章节边界展示合并前的两个章节', () => {
  const [impact] = boundaryImpacts(
    run(['第1章 起', '前段正文。', '第2章 终', '后段正文。'].join('\n')),
    [],
    [{ line: 3, verdict: 'prose', source: 'manual', updatedAt: 1 }],
  )
  expect(impact?.change).toMatchObject({ beforeRole: 'heading', afterRole: 'prose' })
  expect(impact?.before.chapters).toHaveLength(2)
  expect(impact?.after.chapters).toHaveLength(1)
  expect(impact?.change?.addedChars).toBeUndefined()
})
