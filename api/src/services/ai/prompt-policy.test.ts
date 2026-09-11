import { describe, expect, it } from 'vitest'
import {
  contentRefusalMessage,
  detectStructuredContentRefusal,
  detectStructuredContentRefusalFromDetail,
  filterMetadataCategories,
  isStandaloneAdultLabel,
  stripStandaloneAdultLabels,
} from './prompt-policy'

describe('prompt policy boundaries', () => {
  it('removes only standalone rating labels from an analysis copy', () => {
    expect(stripStandaloneAdultLabels('[R18] 成人向, 言情')).toBe('言情')
    expect(stripStandaloneAdultLabels('（18+）|悬疑')).toBe('悬疑')
    expect(stripStandaloneAdultLabels('R180 与 18号房间')).toBe('R180 与 18号房间')
    expect(filterMetadataCategories(['R18', '成人向', '悬疑言情', 'R180'])).toEqual(['悬疑言情', 'R180'])
    expect(isStandaloneAdultLabel('[R18]')).toBe(true)
    expect(isStandaloneAdultLabel('[R18]')).toBe(true)
    expect(isStandaloneAdultLabel('R180')).toBe(false)
  })

  it('recognizes structured refusal fields only', () => {
    expect(detectStructuredContentRefusal({ choices: [{ finish_reason: 'content_filter' }] })).toMatchObject({ reason: 'content_refused', providerCode: 'content_filter' })
    expect(detectStructuredContentRefusal({ choices: [{ delta: { refusal: 'policy' } }] })).toMatchObject({ reason: 'content_refused', message: 'policy' })
    expect(detectStructuredContentRefusal({ error: { code: 'safety_violation', message: 'blocked' } })).toMatchObject({ reason: 'content_refused', providerCode: 'safety_violation' })
    expect(detectStructuredContentRefusal({ choices: [{ message: { content: '抱歉，这是一段正常小说对白。' } }] })).toBeNull()
    expect(detectStructuredContentRefusalFromDetail('{"error":{"code":"content_filter"}}')).toMatchObject({ reason: 'content_refused' })
    expect(contentRefusalMessage({ reason: 'content_refused' })).toContain('上游内容策略拒绝')
  })
})
