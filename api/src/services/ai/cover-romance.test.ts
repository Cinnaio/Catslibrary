import { describe, expect, it } from 'vitest'
import { resolveRomanceVisualDNA } from './cover-romance'

describe('resolveRomanceVisualDNA', () => {
  it('根据合约言情的故事元素提取子类型、关系、物件和场景', () => {
    const dna = resolveRomanceVisualDNA({
      title: '合约到期后他真香了',
      categories: ['现代言情', '豪门总裁'],
      description: '冷面投资人和独立珠宝设计师因合约婚姻展开都市博弈，戒指成为关系转折的证据。',
      variationId: 'contract-a',
    })

    expect(dna.subtype).toBe('contract')
    expect(dna.emotion).toBe('tension')
    expect(dna.visualConcept).toBeTruthy()
    expect(dna.relationshipDynamic).toContain('contract partners')
    expect(dna.visualAnchor).toContain('ring')
    expect(dna.setting).toContain('working studio')
    expect(dna.prompt).toContain('story-defining visual anchor')
  })

  it('同一变体稳定，不同故事会得到不同的视觉 DNA', () => {
    const first = resolveRomanceVisualDNA({
      title: '雨夜玫瑰',
      categories: ['悬疑言情'],
      description: '刑警与急诊医生在连环案件中互相治愈。',
      variationId: 'same-variation',
    })
    const repeat = resolveRomanceVisualDNA({
      title: '雨夜玫瑰',
      categories: ['悬疑言情'],
      description: '刑警与急诊医生在连环案件中互相治愈。',
      variationId: 'same-variation',
    })
    const other = resolveRomanceVisualDNA({
      title: '校园旧信',
      categories: ['校园言情'],
      description: '高中同学在图书馆准备毕业演讲，面对一封没有寄出的信。',
      variationId: 'same-variation',
    })

    expect(repeat).toEqual(first)
    expect(other.subtype).toBe('campus')
    expect(other.setting).not.toBe(first.setting)
    expect(other.visualAnchor).not.toBe(first.visualAnchor)
  })
})
