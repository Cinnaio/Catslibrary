interface ReadingError extends Error { status?: number; data?: unknown; retryAfter?: number }
interface Cooldown { until: number }
const cooldowns = new Map<string, Cooldown>()

export async function withChapterRetry<T>(operation: () => Promise<T>, isCurrent: () => boolean, scope: string): Promise<T> {
  const checkOwner = () => { if (!isCurrent()) throw new Error('账号已变化，请重新读取章节') }
  // Keep cooldowns by the captured account. Concurrent prefetches wait together, never spin on 429.
  let cooldown = cooldowns.get(scope)
  if (!cooldown) {
    for (const [key, value] of cooldowns) if (value.until <= Date.now()) cooldowns.delete(key)
    cooldown = { until: 0 }
    cooldowns.set(scope, cooldown)
  }
  let waited = 0
  for (let attempt = 0; ; attempt++) {
    checkOwner()
    let roundWaited = 0
    while (cooldown.until > Date.now()) {
      const wait = cooldown.until - Date.now()
      if (roundWaited + wait > 65_000 || waited + wait > 125_000) {
        const error = new Error('章节访问暂时受限，请稍后继续阅读') as ReadingError
        error.status = 429
        error.retryAfter = Math.ceil(wait / 1000)
        error.data = { code: 'content_rate_limited', retryAfter: error.retryAfter }
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, wait))
      waited += wait
      roundWaited += wait
      checkOwner()
    }
    checkOwner()
    try { return await operation() }
    catch (error) {
      const failure = error as ReadingError
      const data = failure.data as { code?: string; retryAfter?: number } | undefined
      if (failure.status !== 429 || data?.code !== 'content_rate_limited') throw error
      const seconds = failure.retryAfter ?? data.retryAfter
      if (!Number.isFinite(seconds) || seconds! <= 0 || seconds! > 86400) throw error
      cooldown.until = Math.max(cooldown.until, Date.now() + Math.ceil(seconds! * 1000) + 100)
      if (attempt >= 2 || seconds! > 65) throw error
    }
  }
}
