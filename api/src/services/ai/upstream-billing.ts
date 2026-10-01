import { outboundFetch } from '../outbound-fetch'

export interface BillingFields {
  upstreamRequestId?: string | null
  costSource?: 'response' | 'newapi-log' | null
  costCurrency?: string | null
}

const units = new Map<string, { expires: number; value: number }>()

function nonnegative(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

/** Exact request-ID lookup only. Never use credit, model rates or token/time matching as a bill. */
export async function resolveUpstreamBilling(
  endpoint: string,
  apiKey: string,
  headers: Headers,
  reportedCost: number | null,
): Promise<BillingFields & { cost: number; costReported: boolean }> {
  const gatewayRequestId = headers.get('x-oneapi-request-id')?.trim() || null
  const requestId = gatewayRequestId || headers.get('x-request-id')?.trim() || null
  const unknown = { upstreamRequestId: requestId, cost: 0, costReported: false, costSource: null, costCurrency: null }
  if (reportedCost !== null) return { ...unknown, cost: reportedCost, costReported: true, costSource: 'response' }
  // Only probe a gateway that identifies itself; official APIs incur no extra requests.
  if (!gatewayRequestId || !requestId || requestId.length > 200) return unknown
  try {
    const url = new URL(endpoint)
    const prefix = url.pathname.replace(/\/(?:v\d+\/)?(?:chat\/completions|images\/generations)\/?$/, '')
    if (prefix === url.pathname) return unknown
    const root = url.origin + prefix
    const signal = AbortSignal.timeout(5000)
    const get = async (path: string, authenticated = false): Promise<Record<string, unknown> | null> => {
      const response = await outboundFetch(
        root + path,
        {
          headers: authenticated ? { Authorization: `Bearer ${apiKey}` } : {},
          signal,
          redirect: 'error',
        },
        { scope: 'ai-billing' },
      )
      if (!response.ok) return null
      const result = (await response.json()) as Record<string, unknown>
      return result?.success === true ? result : null
    }
    let unit = units.get(root)
    if (!unit || unit.expires < Date.now()) {
      const status = await get('/api/status')
      const settings = status?.data as Record<string, unknown> | undefined
      const value = nonnegative(settings?.quota_per_unit)
      // USD is confirmed by this gateway's published billing contract; other units remain unknown.
      if (!value || settings?.quota_display_type !== 'USD') return unknown
      unit = { value, expires: Date.now() + 15 * 60_000 }
      if (units.size >= 100) units.clear()
      units.set(root, unit)
    }
    for (const delay of [0, 250, 600]) {
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay))
      if (signal.aborted) return unknown
      const response = await get('/api/log/token', true)
      if (!response) return unknown
      const data = response.data
      const rows = Array.isArray(data) ? data : (data as { items?: unknown[] } | null)?.items
      if (!Array.isArray(rows)) return unknown
      const matched = rows.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === 'object' && (row as Record<string, unknown>).request_id === requestId && Number((row as Record<string, unknown>).type) === 2,
      )
      if (matched.length > 1) return unknown
      if (matched.length === 1) {
        const quota = nonnegative(matched[0]?.quota)
        if (quota === null) return unknown
        return { upstreamRequestId: requestId, cost: quota / unit.value, costReported: true, costSource: 'newapi-log', costCurrency: 'USD' }
      }
    }
  } catch {
    // Billing failure must not retry a completed generation or discard its output.
  }
  return unknown
}
