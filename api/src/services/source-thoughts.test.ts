import { expect, it } from 'vitest'
import { matchSourceParagraphs, sourceThoughtParagraphs } from './source-thoughts'
const source = (texts: string[]) => texts.map((text, i) => ({ index: i * 3 + 7, text, count: 2 }))
it('保留原始来源编号，重复短句仅在整章对应时按位置关联', () => {
  const result = matchSourceParagraphs('甲\n嗯\n乙\n嗯', source(['甲', '嗯', '乙', '嗯']))
  expect(result.map(v => v.source.index)).toEqual([7, 10, 13, 16])
})
it('正文编辑后只重定位可唯一确认的段落', () => {
  const result = matchSourceParagraphs('新增\n甲\n修改\n乙', source(['甲', '旧内容', '乙']))
  expect(result.map(v => [v.paragraphIndex, v.source.index])).toEqual([[1, 7], [3, 13]])
})
it('重复句的上下文无法消歧时不挂评论', () => {
  expect(matchSourceParagraphs('新增\n嗯', source(['甲', '嗯', '乙', '嗯']))).toEqual([])
})
it('同一个源段落不能被两个新段落重复占用', () => {
  expect(matchSourceParagraphs('甲\n甲', source(['甲']))).toEqual([])
})
it('HTML 与 CRLF 章节沿用阅读器段落边界', () => {
  expect(sourceThoughtParagraphs('<p>甲&amp;乙</p><p>丙</p>')).toEqual(['甲&乙', '丙'])
  expect(sourceThoughtParagraphs('甲\r\n\r\n乙')).toEqual(['甲', '乙'])
})
