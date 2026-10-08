import { expect, it } from 'vitest'
import { hashParagraphText } from '@shared/thought-anchor'
import { chapterContainsSelection } from './selection-image'
import { normalizeAiSettings } from './settings'

it('按正文段落和哈希校验，防止挂到错误段落', () => {
  const content = '第一段雨夜。\n第二段晴天。'
  expect(chapterContainsSelection(content, '雨夜', 0, hashParagraphText('第一段雨夜。'))).toBe(true)
  expect(chapterContainsSelection(content, '雨夜', 1, hashParagraphText('第二段晴天。'))).toBe(false)
  expect(chapterContainsSelection(content, '不存在', 0, hashParagraphText('第一段雨夜。'))).toBe(false)
})
it('保留 CR 历史锚点和长正文虚拟分段源锚点', () => {
  const content = '第一段雨夜。\r第二段晴天。'
  expect(chapterContainsSelection(content, '第二段晴天', 0, hashParagraphText(content))).toBe(true)
  const long = '雨夜里灯笼摇晃。'.repeat(100)
  expect(chapterContainsSelection(long, '灯笼摇晃', 0, hashParagraphText(long))).toBe(true)
})
it('HTML 行内格式、实体及 Unicode 数字实体与阅读器文本一致', () => {
  const content = '<p>雨<strong>夜</strong>&nbsp;&amp;&#x1f319;</p><p>天晴</p>'
  expect(chapterContainsSelection(content, '雨夜 &🌙', 0, hashParagraphText('雨夜 &🌙'))).toBe(true)
  expect(chapterContainsSelection('<p>雨&nbsp;夜</p>', '雨 夜', 0, hashParagraphText('雨 夜'))).toBe(true)
})
it('权限配置缺省仅管理员，显式空数组关闭，未知角色不会获权', () => {
  expect(normalizeAiSettings({}).selectionImageRoles).toEqual(['admin'])
  expect(normalizeAiSettings({ selectionImageRoles: [] }).selectionImageRoles).toEqual([])
  expect(normalizeAiSettings({ selectionImageRoles: ['reader', 'guest', 'reader'] }).selectionImageRoles).toEqual(['reader'])
  expect(normalizeAiSettings({ selectionImageRoles: 'admin' }).selectionImageRoles).toEqual([])
})
