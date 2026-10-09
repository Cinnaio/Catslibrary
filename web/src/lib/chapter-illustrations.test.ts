import { describe, expect, it } from 'vitest'
import { resolveIllustrationAnchor, type IllustrationAnchor } from '@shared/chapter-illustrations'
import { makeIllustrationAnchor } from './chapter-illustrations'
import { formatContent } from './reader-utils'

const anchor: IllustrationAnchor = {
  position: 'after',
  paragraphIndex: 1,
  paragraphText: '他推开了门。',
  paragraphHash: '',
  previousText: '雨夜。',
  nextText: '灯火。',
  sourceIndex: 1,
  sourceHash: '',
}
describe('插图位置', () => {
  it('新增前文后跟随唯一原段落，删除或改写后转入待确认', () => {
    expect(resolveIllustrationAnchor(anchor, ['新增。', '雨夜。', '他推开了门。', '灯火。'], false)).toBe(2)
    expect(resolveIllustrationAnchor(anchor, ['雨夜。', '他关上了门。', '灯火。'], false)).toBeNull()
  })
  it('重复段落通过唯一上下文匹配，无法消歧时不猜测', () => {
    expect(resolveIllustrationAnchor(anchor, ['他推开了门。', '雨夜。', '他推开了门。', '灯火。'], false)).toBe(2)
    expect(resolveIllustrationAnchor(anchor, ['雨夜。', '他推开了门。', '灯火。', '雨夜。', '他推开了门。', '灯火。'], false)).toBeNull()
    expect(resolveIllustrationAnchor(anchor, ['雨夜。', '他推开了门。', '灯火。', '他推开了门。'], true)).toBe(1)
  })
  it('章首章尾固定定位，纯 CR 历史正文保留源锚点', () => {
    expect(resolveIllustrationAnchor({ ...anchor, position: 'start' }, [], false)).toBe(-1)
    expect(resolveIllustrationAnchor({ ...anchor, position: 'end' }, ['a', 'b'], false)).toBe(2)
    const root = document.createElement('div')
    root.innerHTML = formatContent('第一段。\r第二段。')
    const paragraphs = Array.from(root.querySelectorAll<HTMLElement>('p'))
    const result = makeIllustrationAnchor(paragraphs, 1)
    expect(result.sourceIndex).toBe(0)
    expect(result.sourceHash).toBe(paragraphs[1]!.dataset.sourceParagraphHash)
    expect(result.paragraphText).toBe('第二段。')
  })
})
