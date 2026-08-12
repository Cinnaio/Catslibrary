import { describe, expect, it } from 'vitest'
import { resolveClientIp } from './audit-context'

describe('resolveClientIp', () => {
  it('falls back to the direct socket address when proxy headers are absent', () => {
    expect(resolveClientIp({}, '::ffff:192.0.2.10')).toBe('192.0.2.10')
  })

  it('prefers the trusted proxy headers and uses the first forwarded address', () => {
    expect(
      resolveClientIp(
        {
          'x-forwarded-for': '198.51.100.20, 10.0.0.2',
          'x-real-ip': '198.51.100.30',
        },
        '192.0.2.10',
      ),
    ).toBe('198.51.100.20')
  })
})
