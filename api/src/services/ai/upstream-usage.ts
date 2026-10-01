/** 不同官方接口及中转站的上游用量，null 表示未回传，0 表示明确未使用。 */
export interface UpstreamUsage {
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  costReported?: boolean
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function tokens(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value !== 'number' && typeof value !== 'string') continue
    if (typeof value === 'string' && !value.trim()) continue
    const count = Number(value)
    if (Number.isSafeInteger(count) && count >= 0) return count
  }
  return null
}

/** 只归一上游计数，不推测未回传的缓存命中，不重复累计别名。 */
export function upstreamUsage(response: unknown): UpstreamUsage & { promptTokens: number | null; completionTokens: number | null } {
  const data = object(response)
  const usage = object(data.usage)
  const promptDetails = object(usage.prompt_tokens_details)
  const inputDetails = object(usage.input_tokens_details)
  const completionDetails = object(usage.completion_tokens_details)
  const outputDetails = object(usage.output_tokens_details)
  const metadata = object(data.usageMetadata)
  const creation = object(usage.cache_creation)
  const shortWrite = tokens(creation.ephemeral_5m_input_tokens)
  const longWrite = tokens(creation.ephemeral_1h_input_tokens)
  const choices = Array.isArray(data.choices) ? data.choices : []
  const choiceCache = choices.map((choice) => object(object(choice).usage).cached_tokens)
  const cacheReadTokens = tokens(
    promptDetails.cached_tokens,
    inputDetails.cached_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cache_read_input_tokens,
    usage.cached_tokens,
    metadata.cachedContentTokenCount,
    ...choiceCache,
    object(data.timings).cache_n,
  )
  const nativeWrite = tokens(promptDetails.cache_write_tokens, inputDetails.cache_write_tokens)
  const convertedWrite = tokens(promptDetails.cached_creation_tokens, inputDetails.cached_creation_tokens)
  const cacheWriteTokens = tokens(
    nativeWrite === null && convertedWrite === null ? null : Math.max(nativeWrite ?? 0, convertedWrite ?? 0),
    usage.cache_creation_input_tokens,
    promptDetails.cache_creation_tokens,
    shortWrite === null && longWrite === null ? null : (shortWrite ?? 0) + (longWrite ?? 0),
  )
  const reasoningTokens = tokens(completionDetails.reasoning_tokens, outputDetails.reasoning_tokens, metadata.thoughtsTokenCount)
  const ordinaryInput = tokens(usage.input_tokens)
  // Claude input_tokens 不包含缓存，OpenAI 的 input_tokens / prompt_tokens 已包含缓存。
  const claudeInput =
    ordinaryInput !== null && ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage || 'cache_creation' in usage)
      ? ordinaryInput + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
      : ordinaryInput
  const hit = tokens(usage.prompt_cache_hit_tokens)
  const miss = tokens(usage.prompt_cache_miss_tokens)
  const candidates = tokens(metadata.candidatesTokenCount)
  return {
    promptTokens: tokens(usage.prompt_tokens, claudeInput, metadata.promptTokenCount, hit !== null && miss !== null ? hit + miss : null),
    completionTokens: tokens(
      usage.completion_tokens,
      usage.output_tokens,
      candidates === null ? null : candidates + (tokens(metadata.thoughtsTokenCount) ?? 0),
    ),
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  }
}

/** 所有真实调用的记账入口复用此映射，避免新增能力漏记缓存。 */
export function usageAuditFields(result: UpstreamUsage & { cost: number }): Required<UpstreamUsage> {
  return {
    cacheReadTokens: result.cacheReadTokens ?? null,
    cacheWriteTokens: result.cacheWriteTokens ?? null,
    reasoningTokens: result.reasoningTokens ?? null,
    costReported: result.costReported ?? result.cost > 0,
  }
}

/** 多次封面文本调用按原有单条审计合并；部分未回传时保留未知状态。 */
export function mergeUsageAuditFields(a: UpstreamUsage & { cost: number }, b: UpstreamUsage & { cost: number }): Required<UpstreamUsage> {
  const left = usageAuditFields(a)
  const right = usageAuditFields(b)
  const sum = (x: number | null, y: number | null) => (x === null || y === null ? null : x + y)
  return {
    cacheReadTokens: sum(left.cacheReadTokens, right.cacheReadTokens),
    cacheWriteTokens: sum(left.cacheWriteTokens, right.cacheWriteTokens),
    reasoningTokens: sum(left.reasoningTokens, right.reasoningTokens),
    costReported: left.costReported && right.costReported,
  }
}
