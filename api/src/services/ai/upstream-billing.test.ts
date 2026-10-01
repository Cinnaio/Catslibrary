import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveUpstreamBilling } from './upstream-billing'

afterEach(() => vi.unstubAllGlobals())

function fixture(host: string, rows: unknown[], settings: unknown = { quota_per_unit: 500000, quota_display_type: 'USD' }) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    const url = String(input)
    if (url.endsWith('/api/status')) {
      expect(init?.headers).toEqual({})
      return Response.json({ success: true, data: settings })
    }
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
    return Response.json({ success: true, data: rows })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { endpoint: `https://${host}.test/v1/chat/completions`, headers: new Headers({ 'x-oneapi-request-id': 'exact' }), fetchMock }
}

describe('NewAPI read-only billing', () => {
  it('does not probe official endpoints or override a reported zero', async () => {
    const { endpoint, headers, fetchMock } = fixture('official', [])
    expect(await resolveUpstreamBilling(endpoint, 'test-key', headers, 0)).toMatchObject({ cost: 0, costReported: true, costSource: 'response' })
    expect(await resolveUpstreamBilling(endpoint, 'test-key', new Headers({ 'x-request-id': 'official-id' }), null)).toMatchObject({
      costReported: false,
      upstreamRequestId: 'official-id',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('preserves billed zero and fractional cost without using response credit', async () => {
    const { endpoint, headers } = fixture('zero', [{ request_id: 'exact', type: 2, quota: 0 }])
    expect(await resolveUpstreamBilling(endpoint, 'test-key', headers, null)).toMatchObject({ cost: 0, costReported: true, costCurrency: 'USD' })
  })
  it.each([
    {
      name: 'duplicate',
      rows: [
        { request_id: 'exact', type: 2, quota: 4 },
        { request_id: 'exact', type: 2, quota: 8 },
      ],
    },
    { name: 'invalid', rows: [{ request_id: 'exact', type: 2, quota: -1 }] },
    { name: 'boolean', rows: [{ request_id: 'exact', type: 2, quota: false }] },
    { name: 'wrongid', rows: [{ request_id: 'other', type: 2, quota: 4 }] },
    { name: 'wrongtype', rows: [{ request_id: 'exact', type: 1, quota: 4 }] },
  ])('leaves $name bills unknown', async ({ name, rows }) => {
    const { endpoint, headers } = fixture(name, rows)
    expect(await resolveUpstreamBilling(endpoint, 'test-key', headers, null)).toMatchObject({ costReported: false })
  })
  it('does not guess an unknown unit or display currency', async () => {
    const { endpoint, headers, fetchMock } = fixture('currency', [], { quota_per_unit: 0, quota_display_type: 'CNY' })
    expect(await resolveUpstreamBilling(endpoint, 'test-key', headers, null)).toMatchObject({ costReported: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('retries a delayed log using exact IDs without repeating generation', async () => {
    const { endpoint, headers, fetchMock } = fixture('delayed', [])
    let count = 0
    fetchMock.mockImplementation(async (input: unknown) =>
      String(input).endsWith('/api/status')
        ? Response.json({ success: true, data: { quota_per_unit: 500000, quota_display_type: 'USD' } })
        : Response.json({ success: true, data: ++count < 2 ? [] : [{ request_id: 'exact', type: 2, quota: 4 }] }),
    )
    expect(await resolveUpstreamBilling(endpoint, 'test-key', headers, null)).toMatchObject({ cost: 0.000008, costReported: true })
    expect(count).toBe(2)
  })
  it('keeps timeout or permission failure separate from successful generation', async () => {
    const { endpoint, headers, fetchMock } = fixture('failure', [])
    fetchMock.mockRejectedValue(new Error('network timeout'))
    expect(await resolveUpstreamBilling(endpoint, 'test-key', headers, null)).toMatchObject({ costReported: false })
  })
})
