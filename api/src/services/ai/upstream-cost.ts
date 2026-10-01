/** 上游账单金额：优先 usage.cost，兼容历史顶层 cost；不按 Token 自行估算。 */
export interface UpstreamCostResponse {
  usage?: { cost?: unknown } | null
  cost?: unknown
}

/** null 表示未回传有效金额，供流式调用保留上一帧；0 是有效成本。 */
export function upstreamCost(data: UpstreamCostResponse | null | undefined): number | null {
  for (const value of [data?.usage?.cost, data?.cost]) {
    if (typeof value !== 'number' && typeof value !== 'string') continue
    if (typeof value === 'string' && !value.trim()) continue
    const amount = Number(value)
    if (Number.isFinite(amount) && amount >= 0) return amount
  }
  return null
}
