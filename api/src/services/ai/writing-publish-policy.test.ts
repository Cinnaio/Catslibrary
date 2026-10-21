import { describe, expect, it } from 'vitest'
import {
  detectRestrictedBodyKeywords,
  evaluateWritingPublishPolicy,
  readFrozenWritingPublishMetadata,
} from './writing-publish-policy'

const CLEAN_BODY = '雨落在青石板上，少年攥紧了那柄断剑，巷口的灯笼被风吹得摇晃。'
const ADULT_BODY = '他把她按在榻上，手指探进那片湿热的秘处，她发出细碎的呻吟。'

function params(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 6,
    taskId: 'task-1',
    contentPreferences: { version: 1, adultContentMode: 'off', intimacyWeight: 'none', adultCharactersConfirmed: false },
    ...overrides,
  })
}

function explicitParams(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 6,
    taskId: 'task-2',
    contentPreferences: { version: 1, adultContentMode: 'explicit', intimacyWeight: 'high', adultCharactersConfirmed: true },
    ...overrides,
  })
}

describe('writing publish policy', () => {
  describe('detectRestrictedBodyKeywords', () => {
    it('flags strong signals only, not the weak context-dependent ones', () => {
      expect(detectRestrictedBodyKeywords(ADULT_BODY).length).toBeGreaterThan(0)
      // 「胸口」「湿了」「高潮」在武侠、医疗、宫斗里同样常见，不能作为发布拦截依据。
      expect(detectRestrictedBodyKeywords('她胸口起伏，衣衫被雨水湿透了。')).toEqual([])
      expect(detectRestrictedBodyKeywords('他气喘吁吁，终于攀上绝顶，迎来武学的高潮。')).toEqual([])
    })

    it('returns an empty list for clean prose and empty input', () => {
      expect(detectRestrictedBodyKeywords(CLEAN_BODY)).toEqual([])
      expect(detectRestrictedBodyKeywords('')).toEqual([])
    })
  })

  describe('evaluateWritingPublishPolicy', () => {
    it('blocks an explicit-mode draft against a non-restricted novel', () => {
      const result = evaluateWritingPublishPolicy({ params_json: explicitParams() }, 'general', CLEAN_BODY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('content_rating_required')
      expect(result.httpStatus).toBe(409)
      expect(result.message).toContain('general')
    })

    it('lets an explicit-mode draft through once the novel is restricted', () => {
      const result = evaluateWritingPublishPolicy({ params_json: explicitParams() }, 'restricted', ADULT_BODY)
      expect(result.ok).toBe(true)
    })

    // 这是本次补的核心缺口：参数说 off，正文却是露骨的。
    // 创作要求是指令层材料，作者完全可以在开关关闭时写下露骨要求并拿到露骨正文。
    it('blocks an off-mode draft whose body carries strong adult signals', () => {
      const result = evaluateWritingPublishPolicy({ params_json: params() }, 'general', ADULT_BODY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('adult_body_requires_restricted')
      expect(result.httpStatus).toBe(409)
      expect(result.message).toContain('restricted')
      // 报错要能指出命中了什么，否则管理员不知道该改哪一段。
      expect(result.message).toMatch(/命中 \d+ 类/)
    })

    it('blocks an off-mode draft against unknown as well as general', () => {
      for (const rating of ['unknown', 'general', undefined]) {
        const result = evaluateWritingPublishPolicy({ params_json: params() }, rating, ADULT_BODY)
        expect(result.ok).toBe(false)
      }
    })

    it('lets an off-mode draft with a clean body through to a general novel', () => {
      const result = evaluateWritingPublishPolicy({ params_json: params() }, 'general', CLEAN_BODY)
      expect(result.ok).toBe(true)
    })

    it('allows an off-mode adult draft once the novel is restricted', () => {
      const result = evaluateWritingPublishPolicy({ params_json: params() }, 'restricted', ADULT_BODY)
      expect(result.ok).toBe(true)
    })

    // 旧草稿没有 contentPreferences 字段，按关闭处理；正文检测必须仍然生效，
    // 否则「字段缺失即放行」会成为一条稳定的绕过路径。
    it('still inspects the body for legacy drafts without frozen preferences', () => {
      const legacy = JSON.stringify({ version: 6, taskId: 'legacy-task' })
      const result = evaluateWritingPublishPolicy({ params_json: legacy }, 'general', ADULT_BODY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('adult_body_requires_restricted')
    })

    it('keeps the corrupted-params path stricter than the missing-field path', () => {
      const corrupted = JSON.stringify({ version: 6, contentPreferences: { version: 99 } })
      const result = evaluateWritingPublishPolicy({ params_json: corrupted }, 'restricted', CLEAN_BODY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('content_preferences_invalid')
    })

    it('skips the body check when content is not supplied (params-only callers)', () => {
      const result = evaluateWritingPublishPolicy({ params_json: params() }, 'general')
      expect(result.ok).toBe(true)
    })

    it('exposes the frozen metadata on success', () => {
      const result = evaluateWritingPublishPolicy({ params_json: params() }, 'general', CLEAN_BODY)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.metadata).toMatchObject({ sourceType: 'ai', aiTaskId: 'task-1', explicitAdult: false })
      expect(result.metadata.contentPreferences.consentRuleTier).toBe('default')
    })
  })

  describe('readFrozenWritingPublishMetadata', () => {
    it('normalizes a legacy draft to the closed default', () => {
      const result = readFrozenWritingPublishMetadata(JSON.stringify({ version: 6 }))
      expect('metadata' in result && result.metadata.explicitAdult).toBe(false)
    })

    it('treats an unparseable params_json as an error rather than closed', () => {
      expect(readFrozenWritingPublishMetadata('{not json')).toEqual({ error: 'params_json 不是有效 JSON' })
    })
  })
})
