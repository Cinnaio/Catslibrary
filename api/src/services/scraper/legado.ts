/**
 * Legado 书源体系 —— 由 Novel-KV _legado.js 平移。
 * 只消费 Legado 书源的规则 JSON，转换器逻辑自研：翻译章节路径三件套
 * chapterList/chapterContent/nextPage，XPath 子集 / @css: / nodechain；
 * @js: / JSONPath / 正则标记 unsupported（存库但不启用）。
 */

export interface LegadoSourceRaw {
  bookSourceUrl?: string
  bookSourceName?: string
  encoding?: number
  ruleToc?: { chapterList?: string; nextTocUrl?: string }
  ruleContent?: { content?: string }
  ruleBook?: Record<string, unknown>
}

export interface TranslatedRule {
  selector: string
  support: 'full' | 'partial' | 'unsupported'
  confidence: number
  warnings: string[]
}

export interface SourceRow {
  host: string
  name: string
  sourceUrl: string
  selectors: Record<string, string>
  metaSelectors: Record<string, string>
  sourceJson: unknown
  encoding: string
  encodingHint: number
  support: 'full' | 'partial' | 'unsupported'
  confidence: number
  warnings: string[]
  enabled: number
}

// ---------- 容错解析 ----------

export function parseLegadoJsonStream(text: string): { sources: LegadoSourceRaw[]; errors: Array<{ error: string; preview: string }>; skipped: number } {
  const sources: LegadoSourceRaw[] = []
  const errors: Array<{ error: string; preview: string }> = []
  if (!text) return { sources, errors, skipped: 0 }
  const str = String(text).trim()
  if (!str) return { sources, errors, skipped: 0 }

  try {
    const parsed = JSON.parse(str)
    if (Array.isArray(parsed)) {
      parsed.forEach((s) => {
        if (s && typeof s === 'object') sources.push(s)
      })
      return { sources, errors, skipped: 0 }
    }
    if (parsed && typeof parsed === 'object') return { sources: [parsed], errors, skipped: 0 }
  } catch {
    /* 落到扫描器 */
  }

  const objects: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start !== -1) {
        objects.push(str.slice(start, i + 1))
        start = -1
      }
      continue
    }
  }

  let skipped = 0
  for (const objText of objects) {
    try {
      sources.push(JSON.parse(objText))
    } catch (e) {
      skipped++
      errors.push({ error: (e as Error).message, preview: objText.slice(0, 120) })
    }
  }
  return { sources, errors, skipped }
}

// ---------- 规范化 ----------

export function normalizeSource(raw: unknown): { name: string; sourceUrl: string; encoding: number | undefined; ruleToc: LegadoSourceRaw['ruleToc']; ruleContent: LegadoSourceRaw['ruleContent']; ruleBook: LegadoSourceRaw['ruleBook']; raw: unknown } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as LegadoSourceRaw
  const sourceUrl = String(r.bookSourceUrl || '').trim()
  if (!sourceUrl) return null
  const host = legadoHost(sourceUrl)
  if (!host) return null
  return {
    name: String(r.bookSourceName || '').trim(),
    sourceUrl,
    encoding: r.encoding,
    ruleToc: r.ruleToc && typeof r.ruleToc === 'object' ? r.ruleToc : {},
    ruleContent: r.ruleContent && typeof r.ruleContent === 'object' ? r.ruleContent : {},
    ruleBook: r.ruleBook && typeof r.ruleBook === 'object' ? r.ruleBook : {},
    raw,
  }
}

export function legadoHost(sourceUrl: string): string | null {
  if (!sourceUrl) return null
  let url = String(sourceUrl).trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url
  try {
    const u = new URL(url)
    return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  } catch {
    return null
  }
}

export function encodeLegadoEncoding(int: number | undefined): string | null {
  switch (Number(int)) {
    case 0:
      return null
    case 1:
      return 'utf-8'
    case 2:
      return 'gbk'
    case 3:
      return 'gb2312'
    case 4:
      return 'gb18030'
    case 5:
      return 'big5'
    default:
      return null
  }
}

function hostKey(h: string): string {
  return String(h || '').toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace(/\.$/, '')
}

export function hostMatches(a: string, b: string): boolean {
  return hostKey(a) === hostKey(b)
}

// ---------- 规则翻译 ----------

function unsupported(message: string, conf: number): TranslatedRule {
  return { selector: '', support: 'unsupported', confidence: conf || 5, warnings: [message] }
}

function stripContentSuffix(rule: string): string {
  let r = String(rule || '').trim()
  const hashIdx = r.indexOf('##')
  if (hashIdx !== -1) r = r.slice(0, hashIdx).trim()
  r = r.replace(/@(?:html|text|textNodes)$/i, '').trim()
  return r
}

function finalize(selector: string, flavor: string, warnings: string[], opts: { degraded?: boolean } = {}): TranslatedRule {
  if (!selector) return unsupported('翻译结果为空', 10)
  const base = flavor === 'css' ? 92 : flavor === 'xpath' ? 84 : flavor === 'nodechain' ? 86 : 80
  let support: TranslatedRule['support'] = 'full'
  let confidence = base
  if (opts.degraded) {
    support = 'partial'
    confidence = 45
  }
  if (warnings && warnings.length) confidence = Math.max(20, confidence - 10 * warnings.length)
  return { selector, support, confidence: Math.min(99, Math.max(0, confidence)), warnings: warnings || [] }
}

function isNovelKvSelector(sel: string): boolean {
  if (!sel) return false
  const s = String(sel).trim()
  if (/^meta\[/i.test(s)) return true
  if (/[\[\]>+~=]/.test(s)) return false
  return /^[\w.#\-_:()\s]+$/.test(s)
}

export function translateRule(rule: unknown, kind: 'chapterList' | 'content' | 'title' | 'nextPage' | 'meta', _ctx?: unknown): TranslatedRule {
  const raw = String(rule == null ? '' : rule).trim()
  if (!raw) return unsupported('规则为空', 0)
  const warnings: string[] = []
  let work = raw

  if (/^@js:/i.test(work)) return unsupported('@js 规则不支持', 5)

  if (/^<js>/i.test(work)) {
    const m = work.match(/^<js>[\s\S]*?<\/js>\s*([\s\S]*)$/i)
    const rest = (m && m[1] ? m[1] : '').trim()
    if (!rest) return unsupported('JS 块规则不支持', 10)
    warnings.push('已剥离 JS 块前缀，规则可能不完整')
    work = rest
  }

  if (/^\$\s*[.\[]/.test(work)) return unsupported('JSONPath 规则不支持', 5)

  if (/^@css:/i.test(work)) {
    work = work.replace(/^@css:\s*/i, '').trim()
    if (work.includes(',')) {
      warnings.push('多分支 CSS 已取第一个')
      work = work.split(',')[0]!.trim()
    }
    if (kind === 'content') work = stripContentSuffix(work)
    if (isNovelKvSelector(work)) return finalize(work, 'css', warnings)
    const idAnchor = work.match(/#([\w-]+)/)?.[1]
    const classAnchor = work.match(/\.([\w-]+)/)?.[1]
    const anchor = idAnchor ? '#' + idAnchor : classAnchor ? '.' + classAnchor : ''
    if (anchor && kind === 'chapterList') {
      warnings.push('CSS 选择器超出能力，已按锚点降级')
      return finalize(anchor + ' a', 'css', warnings, { degraded: true })
    }
    return unsupported('CSS 选择器超出解析器能力', 20)
  }

  if (/^\/\//.test(work)) return translateXPath(work, kind, warnings)

  if (looksLikeNodeChain(work)) return translateNodeChain(work, kind, warnings)

  if (isNovelKvSelector(work)) {
    if (kind === 'content') work = stripContentSuffix(work)
    return finalize(work, 'plain', warnings)
  }

  return unsupported('无法识别的规则形态（正则/其他）', 5)
}

function looksLikeNodeChain(s: string): boolean {
  const first = String(s).split('@')[0]!.trim()
  return /^(?:id|class|tag|@tag|text|@css|css)\./i.test(first)
}

function translateXPath(xpath: string, kind: string, warnings: string[]): TranslatedRule {
  if (xpath.includes('||')) {
    warnings.push('XPath 多分支已取第一个')
    xpath = xpath.split('||')[0]!
  }
  const x = xpath.trim().replace(/^\.\/\//, '//')
  const tokens = x.split('/').filter(Boolean)
  if (tokens.length === 0) return unsupported('XPath 无法解析', 10)

  for (const token of tokens) {
    const idM = token.match(/\[@id\s*=\s*['"]([^'"]+)['"]\]/i)
    const classM =
      token.match(/\[@class\s*=\s*['"]\s*([^'"]+?)\s*['"]\]/i) ||
      token.match(/\[contains\(\s*@class\s*,\s*['"]\s*([^'"]+?)\s*['"]\s*\)\]/i)
    let anchor = ''
    if (idM) anchor = '#' + idM[1]!.trim()
    else if (classM) anchor = classM[1]!.trim().split(/\s+/).filter(Boolean).map((c) => '.' + c).join('')
    if (anchor) {
      if (kind === 'chapterList') return finalize(anchor + ' a', 'xpath', warnings)
      return finalize(anchor, 'xpath', warnings)
    }
  }

  warnings.push('XPath 无 id/class 锚点，已降级')
  const lastTag = (tokens[tokens.length - 1] || '').split(/[\[@]/)[0]!.trim()
  if (kind === 'chapterList') return finalize('a', 'xpath', warnings, { degraded: true })
  if (lastTag && lastTag !== '*') return finalize(lastTag, 'xpath', warnings, { degraded: true })
  return unsupported('XPath 无有效节点', 10)
}

function translateNodeChain(chain: string, kind: string, warnings: string[]): TranslatedRule {
  const parts = String(chain).split('@').map((p) => p.trim()).filter(Boolean)
  let anchor = ''
  let sawAnchor = false
  let endsWithA = false
  for (const rawPart of parts) {
    const p = rawPart.replace(/\.\d+$/, '').replace(/\[\s*[\w:+\-.\s]*\]\s*$/, '').replace(/^!/, '').trim()
    let m
    if ((m = p.match(/^id\.([\w-]+)/i))) {
      anchor = '#' + m[1]!
      sawAnchor = true
    } else if ((m = p.match(/^class\.([\w\s-]+)/i))) {
      anchor = m[1]!.split(/\s+/).filter(Boolean).map((c) => '.' + c).join('')
      sawAnchor = true
    } else if (/^@css\./i.test(p) && !anchor) {
      anchor = p.replace(/^@css\./i, '').trim()
      sawAnchor = true
    } else if ((m = p.match(/^(?:@tag\.|tag\.)?(a|li|dd|ul|div|p)$/i))) {
      if (m[1]!.toLowerCase() === 'a') endsWithA = true
    } else if (p.toLowerCase() === 'a') {
      endsWithA = true
    }
  }
  if (!sawAnchor) {
    warnings.push('nodechain 无 id/class 锚点，已降级')
    return finalize(kind === 'chapterList' ? 'a' : '', 'nodechain', warnings, { degraded: true })
  }
  if (kind === 'chapterList') {
    const opts = endsWithA ? {} : { degraded: true }
    if (!endsWithA) warnings.push('nodechain 结尾非 a，已放宽为锚点内全部链接')
    return finalize(anchor + ' a', 'nodechain', warnings, opts)
  }
  return finalize(anchor, 'nodechain', warnings)
}

export function scoreTranslation(parts: Record<string, TranslatedRule | undefined>): { support: string; confidence: number } {
  const required = [parts.chapterList, parts.chapterContent]
  const present = required.filter(Boolean) as TranslatedRule[]
  if (present.length === 0) return { support: 'unsupported', confidence: 0 }
  const hasUnsupported = required.some((p) => !p || p.support === 'unsupported')
  if (hasUnsupported) {
    const conf = present.reduce((s, p) => s + (p.confidence || 0), 0) / present.length
    return { support: 'unsupported', confidence: Math.min(20, Math.round(conf)) }
  }
  const allFull = present.every((p) => p.support === 'full')
  const confidence = Math.round(present.reduce((s, p) => s + (p.confidence || 0), 0) / present.length)
  return { support: allFull ? 'full' : 'partial', confidence }
}

function translateMetaRules(ruleBook: Record<string, unknown> | undefined): Record<string, string> {
  if (!ruleBook || typeof ruleBook !== 'object') return {}
  const map: Record<string, string> = { name: 'title', author: 'author', intro: 'description', coverUrl: 'cover', kind: 'category' }
  const meta: Record<string, string> = {}
  for (const [legadoKey, nkKey] of Object.entries(map)) {
    const rule = String(ruleBook[legadoKey] || '').trim()
    if (!rule) continue
    const t = translateRule(rule, 'meta')
    if (t.selector && isNovelKvSelector(t.selector)) meta[nkKey] = t.selector
  }
  return meta
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr || []))
}

export function buildSourceRow(n: NonNullable<ReturnType<typeof normalizeSource>>, host: string): SourceRow {
  const tl = translateRule(n.ruleToc?.chapterList, 'chapterList')
  const tc = translateRule(n.ruleContent?.content, 'content')
  const tnRaw = String((n.ruleToc && n.ruleToc.nextTocUrl) || '').trim()
  const tn = tnRaw ? translateRule(tnRaw, 'nextPage') : { selector: '', support: 'partial' as const, confidence: 0, warnings: [] }
  const meta = translateMetaRules(n.ruleBook)
  const { support, confidence } = scoreTranslation({ chapterList: tl, chapterContent: tc, nextPage: tn })
  const warnings = dedupe([...(tl.warnings || []), ...(tc.warnings || []), ...(tn.warnings || [])])
  const encoding = encodeLegadoEncoding(n.encoding)
  return {
    host,
    name: n.name || host,
    sourceUrl: n.sourceUrl,
    selectors: {
      chapterList: tl.selector || '',
      chapterTitle: '',
      chapterContent: tc.selector || '',
      nextPage: tn.selector || '',
    },
    metaSelectors: meta,
    sourceJson: n.raw || {},
    encoding: encoding || 'utf-8',
    encodingHint: Number(n.encoding) || 0,
    support: support as SourceRow['support'],
    confidence,
    warnings,
    enabled: support === 'unsupported' ? 0 : 1,
  }
}

/** 行 → 与 SITE_PRESETS 对齐的 preset 对象。 */
export function sourceToPreset(row: Record<string, unknown> | null | undefined): { name: string; encoding: string; selectors: Record<string, string>; meta: Record<string, string> | null; source: unknown } | null {
  if (!row) return null
  let selectors: Record<string, string> = {}
  let meta: Record<string, string> = {}
  try {
    selectors = JSON.parse(String(row.selectors || '{}'))
  } catch {
    /* ignore */
  }
  try {
    meta = JSON.parse(String(row.meta_selectors || '{}'))
  } catch {
    /* ignore */
  }
  const isEmptyMeta = !meta || Object.keys(meta).every((k) => !meta[k])
  return {
    name: String(row.name || row.host || ''),
    encoding: String(row.encoding || 'utf-8'),
    selectors,
    meta: isEmptyMeta ? null : meta,
    source: row,
  }
}
