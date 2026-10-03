import { expect, it } from 'vitest'
import type { Thought } from '@shared/types'
import { formatContent, groupChapterThoughts, hashParagraphText, resolveThoughtParagraph } from './reader-utils'
it('插入段落后沿哈希移动，不把旧想法挂到原下标的新正文', () => {
  const thought = { id: 't', paragraphIndex: 0, paragraphHash: hashParagraphText('原文') } as Thought
  expect(groupChapterThoughts([thought], formatContent('新增\n原文'))).toEqual({ '1': [thought] })
})
it('正文被修改或重复段无法消歧时保留为失去定位的想法', () => {
  const thought = { id: 't', paragraphIndex: 0, paragraphHash: hashParagraphText('原文') } as Thought
  expect(groupChapterThoughts([thought], formatContent('新正文'))).toEqual({ '-1': [thought] })
  expect(resolveThoughtParagraph(thought, ['different', thought.paragraphHash, thought.paragraphHash])).toBeNull()
  expect(resolveThoughtParagraph(thought, [thought.paragraphHash, thought.paragraphHash])).toBe(0)
})
it('历史无哈希想法仅按有效下标兼容', () => {
  expect(resolveThoughtParagraph({ paragraphIndex: 0, paragraphHash: '' }, ['a'])).toBe(0)
  expect(resolveThoughtParagraph({ paragraphIndex: 2, paragraphHash: '' }, ['a'])).toBeNull()
})
