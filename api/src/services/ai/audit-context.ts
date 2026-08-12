/** Resolve the client address from proxy headers, then the direct socket address. */
export function resolveClientIp(headers: Record<string, string | undefined>, remoteAddress = ''): string {
  const forwarded = headers['cf-connecting-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim() || headers['x-real-ip'] || ''
  if (forwarded) return forwarded

  return remoteAddress.replace(/^::ffff:/i, '')
}
