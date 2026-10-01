import { describe, expect, it } from 'vitest'
import { formatCost } from './shared'

describe('upstream cost precision', () => {
  it.each([
    [0.4, '0.000004'],
    [0.8, '0.000008'],
    [1.2, '0.000012'],
    [0, '0.0000'],
    [100000, '1.0000'],
  ])('formats %s without losing small billed amounts', (value, expected) => {
    expect(formatCost(Number(value))).toBe(expected)
  })
})
