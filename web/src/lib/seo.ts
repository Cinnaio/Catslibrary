export const SEO_DESCRIPTION = '知舟 — 发现精彩小说，享受阅读之美'

export function setPageSeo(indexable: boolean, description = SEO_DESCRIPTION, path?: string) {
  const origin = document.querySelector<HTMLMetaElement>('meta[name="zhizhou-seo-origin"]')?.content
  const tags: [string, string][] = [
    ['robots', origin && indexable ? 'index, follow' : 'noindex, follow'],
    ['description', description],
  ]
  for (const [name, content] of tags) {
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = name
      document.head.append(meta)
    }
    meta.content = content
  }
  const existing = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (origin && path) {
    const canonical = existing || document.createElement('link')
    canonical.rel = 'canonical'
    canonical.href = origin + path
    if (!existing) document.head.append(canonical)
  } else existing?.remove()
}
