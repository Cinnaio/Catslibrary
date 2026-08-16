import { describe, expect, it } from 'vitest'
import { accentInk, isValidHex, mixWithWhite, relativeLuminance } from './color'

describe('isValidHex', () => {
  it('接受 #RRGGBB', () => {
    expect(isValidHex('#8B6045')).toBe(true)
    expect(isValidHex('#abcdef')).toBe(true)
    expect(isValidHex('#FFFFFF')).toBe(true)
  })

  it('拒绝非法值', () => {
    expect(isValidHex('8B6045')).toBe(false)
    expect(isValidHex('#FFF')).toBe(false)
    expect(isValidHex('#GGGGGG')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })
})

describe('relativeLuminance', () => {
  it('黑白边界', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('已知中间值', () => {
    expect(relativeLuminance('#777777')).toBeCloseTo(0.184, 3)
  })

  it('非法值按 0 处理', () => {
    expect(relativeLuminance('nope')).toBe(0)
  })
})

describe('accentInk', () => {
  it('深色与默认奶茶棕用白字', () => {
    expect(accentInk('#8B6045')).toBe('#FFFFFF')
    expect(accentInk('#1D1510')).toBe('#FFFFFF')
  })

  it('亮色用深墨字', () => {
    expect(accentInk('#FFE14D')).toBe('#1D1510')
    expect(accentInk('#F5F2EE')).toBe('#1D1510')
  })
})

describe('mixWithWhite', () => {
  it('向白色混合', () => {
    expect(mixWithWhite('#000000', 0.22)).toBe('#383838')
    expect(mixWithWhite('#FFFFFF', 0.22)).toBe('#ffffff')
    expect(mixWithWhite('#808080', 0)).toBe('#808080')
  })

  it('非法值原样返回', () => {
    expect(mixWithWhite('nope', 0.5)).toBe('nope')
  })
})
