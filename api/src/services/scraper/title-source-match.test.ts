import { describe, expect, it } from 'vitest'
import { matchTitleSource, rankTitleSources } from './title-source-match'

describe('标题源候选初筛', () => {
  it('跨简繁体、空格标点和括号备注识别书名及作者', () => {
    expect(matchTitleSource({ title: '離婚（H）【完結】', author: ' 子 境 ' }, '离婚', '子境')).toMatchObject({
      confidence: 'high', matchScore: 90, matchReason: '书名一致（忽略括号备注） · 作者一致',
    })
    expect(matchTitleSource({ title: '《離 婚》', author: '子境' }, '离婚', '子境')).toMatchObject({ confidence: 'high', matchScore: 100 })
  })

  it('同名不同作者及缺失作者需要核对，不能作为高置信匹配', () => {
    expect(matchTitleSource({ title: '离婚', author: '别人' }, '离婚', '子境')).toMatchObject({ confidence: 'medium', matchReason: '书名一致 · 作者不一致' })
    expect(matchTitleSource({ title: '离婚', author: '' }, '离婚', '子境')).toMatchObject({ confidence: 'medium', matchReason: '书名一致 · 作者未识别' })
  })

  it('仅搜索作者时，作者的其他作品不会被误判为高置信匹配', () => {
    expect(matchTitleSource({ title: '另一部作品', author: '子境' }, '', '子境').confidence).toBe('medium')
    expect(matchTitleSource({ title: '另一部作品', author: '子境' }, '离婚', '子境')).toMatchObject({ confidence: 'medium', matchReason: '书名不一致 · 作者一致' })
    expect(matchTitleSource({ title: '离婚', author: '子境' }, '', '').confidence).toBe('low')
  })

  it('仅书名搜索允许完整同名优先，部分相似和括号备注仍需核对', () => {
    expect(matchTitleSource({ title: '離婚', author: '子境' }, '离婚', '').confidence).toBe('high')
    expect(matchTitleSource({ title: '離婚（H）', author: '子境' }, '离婚', '').confidence).toBe('medium')
    expect(matchTitleSource({ title: '离婚之后', author: '子境' }, '离婚', '子境').confidence).toBe('medium')
    expect(matchTitleSource({ title: '漫长书名的一个字婚', author: '别人' }, '婚', '').confidence).toBe('low')
  })

  it('高置信匹配排在前面，同级按匹配程度排序且保留所有候选', () => {
    const candidates = [
      { id: 'unrelated', title: '其他书', author: '别人' },
      { id: 'same-author', title: '其他书', author: '子境' },
      { id: 'wrong-author', title: '离婚', author: '别人' },
      { id: 'annotated', title: '離婚（H）', author: '子境' },
      { id: 'exact', title: '离婚', author: '子境' },
    ]
    expect(rankTitleSources(candidates, '离婚', '子境').map(candidate => candidate.id)).toEqual(['exact', 'annotated', 'wrong-author', 'same-author', 'unrelated'])
    expect(candidates[0]?.id).toBe('unrelated')
  })
})
