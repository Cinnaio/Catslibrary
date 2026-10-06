/** 原生知舟客户端的 URLSession 默认 UA。避免把其他 CFNetwork 客户端误认成知舟。 */
export function isZhiZhouIosApp(userAgent: string): boolean {
  return /^ZhiZhou\/\S+(?:\s|$)/i.test(userAgent) && /\bCFNetwork\//i.test(userAgent) && /\bDarwin\//i.test(userAgent)
}
