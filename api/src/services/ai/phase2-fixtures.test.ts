import { describe, expect, it } from 'vitest'
import { validateWritingBrief } from './writing'
import { PHASE2_COVER_FIXTURES, PHASE2_WRITING_FIXTURES, phase2FixtureBudget } from './phase2-fixtures'

function expectUniqueIDs(values: readonly { id: string }[]) {
  const ids = values.map((value) => value.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true)
}

describe('B6 phase-2 fixed fixtures', () => {
  it('固定六组续写样本，brief 可按批次严格规范化', () => {
    expect(PHASE2_WRITING_FIXTURES).toHaveLength(6)
    expectUniqueIDs(PHASE2_WRITING_FIXTURES)
    for (const fixture of PHASE2_WRITING_FIXTURES) {
      expect(fixture.seed.length).toBeGreaterThan(10)
      expect(fixture.context.length).toBeGreaterThan(10)
      const validated = validateWritingBrief(fixture.writingBrief, fixture.chapterCount)
      expect(validated.error).toBeUndefined()
      expect(validated.brief?.version).toBe(1)
      expect(validated.brief?.chapterGoals.map((goal) => goal.index)).toEqual(
        [...(validated.brief?.chapterGoals || [])].map((goal) => goal.index).sort((a, b) => a - b),
      )
      expect(fixture.expectedProviderCalls.image).toBe(0)
      expect(fixture.expectedProviderCalls.text).toBe(fixture.chapterCount)
    }
  })

  it('固定六组封面需求，覆盖文字开关、exact、构图和长描述词', () => {
    expect(PHASE2_COVER_FIXTURES).toHaveLength(6)
    expectUniqueIDs(PHASE2_COVER_FIXTURES)
    expect(PHASE2_COVER_FIXTURES.some((fixture) => fixture.renderTitle)).toBe(true)
    expect(PHASE2_COVER_FIXTURES.some((fixture) => !fixture.renderTitle)).toBe(true)
    expect(PHASE2_COVER_FIXTURES.filter((fixture) => fixture.promptMode === 'exact')).toHaveLength(2)
    expect(new Set(PHASE2_COVER_FIXTURES.map((fixture) => fixture.composition)).size).toBeGreaterThanOrEqual(4)
    for (const fixture of PHASE2_COVER_FIXTURES) {
      expect(fixture.title.length).toBeGreaterThan(0)
      expect(fixture.author.length).toBeGreaterThan(0)
      expect(Array.from(fixture.prompt).length).toBeLessThanOrEqual(2000)
      expect(fixture.expectedProviderCalls.image).toBe(1)
      if (fixture.promptMode === 'exact') {
        expect(fixture.renderTitle).toBe(false)
        expect(fixture.expectedProviderCalls.text).toBe(0)
        expect(fixture.prompt.length).toBeGreaterThan(0)
      } else {
        expect(fixture.prompt).toBe('')
        expect(fixture.description.length).toBeGreaterThan(10)
        expect(fixture.expectedProviderCalls.text).toBe(2)
      }
    }
  })

  it('预算只记录预期供应商调用次数，不伪造费用', () => {
    expect(phase2FixtureBudget()).toEqual({
      writing: { text: 8, image: 0 },
      cover: { text: 8, image: 6 },
    })
  })
})
