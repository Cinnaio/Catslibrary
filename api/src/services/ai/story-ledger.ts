import { createHash } from 'node:crypto'
import type { StoryCertainty, StoryGraph } from '@shared/story-graph'
import { AiError } from './client'

export const LEDGER_VERSION = 1
/** Bump when extraction semantics change, without changing the stored JSON schema. */
export const LEDGER_PROMPT_VERSION = 4
export type EntityKind = 'person' | 'item' | 'place' | 'faction'
export type FactKind = 'fact' | 'state' | 'relationship' | 'boundary' | 'clue' | 'conflict' | 'item' | 'place'
export interface MemoryEntity {
  id: string
  name: string
  aliases: string[]
  kind: EntityKind
  aliasEvidence?: Array<{ alias: string; quote: string; chapterId: string; ordinal: number }>
}
export interface MemoryFact {
  id: string
  memoryType: 'state' | 'event'
  kind: FactKind
  subjects: string[]
  label: string
  summary: string
  certainty: StoryCertainty
  perspective?: string
  directed?: boolean
  status: 'active' | 'resolved'
  scope: 'local' | 'global'
  replaces: string[]
  quote: string
  chapterId: string
  ordinal: number
  /** 落库记录里不存在；仅在「送给模型的参考集」中标注：该记录已被后续状态替换，
   * 保留只是为了提供历史依据，不能再被 replaces 引用。 */
  stillActive?: boolean
}
export interface ChapterMemory {
  version: 1
  entities: MemoryEntity[]
  facts: MemoryFact[]
}
export interface LedgerState {
  entities: MemoryEntity[]
  facts: MemoryFact[]
}
export const emptyLedger = (): LedgerState => ({ entities: [], facts: [] })
export const ledgerHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (message: string): never => {
  throw new AiError('invalid', `章节记忆校验失败：${message}；未推进该章，请核对后重试`, 422)
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('需要 JSON 对象')
  return value as Record<string, unknown>
}
const str = (value: unknown, max: number, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail(`${field} 缺失或过长`)
  return value.trim()
}
const strings = (value: unknown, max: number, field: string): string[] => {
  if (!Array.isArray(value) || value.length > max) return fail(`${field} 数组无效`)
  return [...new Set(value.map((v) => str(v, 100, field)))]
}
const enumValue = <T extends string>(value: unknown, values: readonly T[], field: string): T =>
  values.includes(value as T) ? (value as T) : fail(`${field} 无效`)

/** 枚举字段的近义归一：模型偶尔把「事实类别」写成 event/关系别名。 */
const ENUM_SYNONYMS: Record<string, string> = {
  event: 'fact',
  event_fact: 'fact',
  relationship_change: 'relationship',
  relation: 'relationship',
  relations: 'relationship',
}
const lenientEnum = <T extends string>(value: unknown, values: readonly T[], _field: string): T | undefined => {
  const raw = String(value ?? '').trim().toLowerCase()
  const mapped = ENUM_SYNONYMS[raw] ?? raw
  return values.includes(mapped as T) ? (mapped as T) : undefined
}

/**
 * 正文依据的比对口径：只抹平「排版噪音」，不容忍任何实词增删。
 *
 * 模型抽取 50 条以上事实时，偶尔会把引文里的空格、全半角标点、引号写成另一种形式；
 * 这不影响「这句话确实出自本章」，但会让最严格的 includes 把整章判负（一次调用
 * 6 分钟、2 万 token 全部作废）。因此比较时折叠空白与标点，同时保留汉字、字母、
 * 数字的完整序列；任何改写、合并、省略仍会失败。
 */
const MATCH_IGNORABLE = /[\s\u00a0\u3000\u200b\ufeff"'“”‘’「」『』〈〉《》（）()［］\[\]【】{}，。、；：！？,.;:!?~～—－…·…⋯　\-_\u2010-\u2015/\\|]/gu
export function normalizeForSourceMatch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(MATCH_IGNORABLE, '')
}
/** 归一化后至少要留下这么多实字，避免空串或单个标点通过校验。 */
const MIN_QUOTE_MATCH_CHARS = 4

/** 引文比对口径与内容判定口径必须一致：正文里嵌着的 JSON/代码块如果参与比对，
 * 模型给出的原文片段（已剥掉那些包裹字符）会永远匹配失败。 */
const minifyFragment = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
export const sourceMatchText = (text: string) => normalizeForSourceMatch(text) || normalizeForSourceMatch(minifyFragment(text))

/** 引文是否逐字来自正文（容忍排版噪音，不容忍改写）。 */
export function quoteMatchesText(text: string, quote: string): boolean {
  return sourceSpan(text, quote) !== ''
}

/** 引文在正文中的原样片段；不匹配时返回空串。落库时用原文片段，避免把模型改写版存进证据。 */
export function sourceSpan(text: string, quote: string): string {
  const needle = normalizeForSourceMatch(quote)
  if (needle.length < MIN_QUOTE_MATCH_CHARS) return ''
  if (!sourceMatchText(text)) return ''
  let from = -1
  let counted = 0
  for (let i = 0; i < text.length; i++) {
    if (normalizeForSourceMatch(text[i]!).length !== 1) continue
    if (from < 0) {
      if (normalizeForSourceMatch(text.slice(i)).startsWith(needle)) {
        from = i
        counted = 1
      }
      continue
    }
    counted++
    if (counted === needle.length) return text.slice(from, i + 1)
  }
  return ''
}

/** 代词补全名（正文只写「他父亲」，模型给出「萧炎父亲」）的落点判定：
 * 关系后缀本身在正文出现，且后缀前的人名也在正文出现。
 * 命中即保留（低置信），不要求模型额外给出 identityQuote。 */
const RELATION_SUFFIX = /(父亲大人|母亲大人|父亲|母亲|爹|娘|爷爷|奶奶|外公|外婆|兄长|哥哥|弟弟|姐姐|妹妹|师父|师傅|师尊|弟子|徒弟|师兄|师姐|家主|族长|管家|叔叔|婶婶|舅舅|姑母|表哥|表妹)$/u
export function canonicalNameGrounded(name: string, text: string): boolean {
  const suffix = name.match(RELATION_SUFFIX)?.[1]
  if (!suffix) return false
  const head = name.slice(0, name.length - suffix.length)
  if (head.length < 2 || !text.includes(head)) return false
  return text.includes(suffix)
}

/** 模型常把认知/事件类值写进事实类别：entities 没有其他可落点，按名字推断；
 * 事实则按 certainty 与 memoryType 还原语义再映射类别，避免把"人物认知"降级。 */
const ENTITY_NAME_KIND = /(大殿|大厅|客栈|酒馆|城外|城内|山上|山下|后山|密道|广场|庭院|房间|书房|街道|城门|家$|家族|门派|宗门|学院|商会|帝国|大陆|王国|城$|山$|府$|宫$|殿$|坊$|局$|堂$)/u

export function coerceFactKind(kind: unknown, item: Record<string, unknown>): string {
  const raw = String(kind ?? '').trim()
  if (['fact', 'state', 'relationship', 'boundary', 'clue', 'conflict', 'item', 'place'].includes(raw)) return raw
  const memoryType = String(item.memoryType ?? '').trim()
  const certainty = String(item.certainty ?? '').trim()
  if (raw === 'belief' || raw === 'cognition' || raw === 'knowledge') return certainty === 'belief' ? 'state' : 'clue'
  if (raw === 'event') return memoryType === 'event' ? 'fact' : 'fact'
  return raw
}

export function coerceEntityKind(kind: unknown, name: string): EntityKind | string {
  const raw = String(kind ?? '').trim()
  if (['person', 'item', 'place', 'faction'].includes(raw)) return raw as EntityKind
  if (raw === 'event' || raw === 'location' || raw === 'scene') return ENTITY_NAME_KIND.test(name) ? 'place' : 'person'
  return raw
}

export function currentFacts(state: LedgerState): MemoryFact[] {
  const replaced = new Set(state.facts.flatMap((f) => f.replaces))
  return state.facts.filter((f) => !replaced.has(f.id))
}

/** Durable active state is the working set; chapter actions and resolved matters
 * remain searchable history, rather than gradually recreating a full transcript. */
export function workingFacts(state: LedgerState): MemoryFact[] {
  return currentFacts(state).filter((f) => f.status === 'active' && (f.memoryType === 'state' || f.scope === 'global'))
}

/** Match entity aliases and explicit query terms, then include their immediate relations.
 * No token clipping: large relevant sets remain visible, and missing terms can be requested. */
export function relevantLedger(
  state: LedgerState,
  text: string,
  queries: string[] = [],
  historyMode: 'explicit' | 'topics' = 'explicit',
  activeOnly = false,
): LedgerState {
  const haystack = `${text}\n${queries.join('\n')}`.toLocaleLowerCase()
  const names = new Set(state.entities.flatMap((e) => [e.name, ...e.aliases]).map((n) => n.toLocaleLowerCase()))
  const terms = [
    ...new Set([
      ...queries.flatMap((q) => [q, ...(q.match(/[\p{Script=Han}]{2,8}|[a-zA-Z0-9_]{2,32}/gu) || [])]),
      ...state.facts.filter((f) => queries.some((q) => q.includes(f.label))).map((f) => f.label),
    ]),
  ].filter((term) => historyMode === 'explicit' || !names.has(term.toLocaleLowerCase()))
  const ids = new Set(state.entities.filter((e) => [e.name, ...e.aliases].some((n) => haystack.includes(n.toLocaleLowerCase()))).map((e) => e.id))
  // 章节抽取（activeOnly）只认当前有效记录：已被替换的旧记录不能再回到替换候选里。
  const pool = activeOnly ? currentFacts(state).filter((f) => f.status === 'active') : state.facts
  const current = workingFacts(state)
  const direct = current.filter(
    (f) => f.subjects.some((id) => ids.has(id)) || terms.some((q) => `${f.label} ${f.summary}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())),
  )
  const related = new Set([...ids, ...direct.flatMap((f) => f.subjects)])
  const wanted = new Set(direct.map((f) => f.id))
  for (const f of current) if (f.scope === 'global' || f.kind === 'boundary' || f.subjects.some((id) => related.has(id))) wanted.add(f.id)
  const replaceable = new Set(current.map((f) => f.id))
  // History is expanded only for explicit supplementary queries, never merely
  // because the protagonist occurs in every chapter.
  const historical = pool.filter((f) =>
    terms.some((q) =>
      `${f.label} ${f.summary} ${f.subjects.map((id) => state.entities.find((e) => e.id === id)?.name).join(' ')}`
        .toLocaleLowerCase()
        .includes(q.toLocaleLowerCase()),
    ),
  )
  historical.forEach((f) => wanted.add(f.id))
  const byId = new Map(state.facts.map((f) => [f.id, f]))
  const add = (id: string) => {
    if (!wanted.has(id)) {
      wanted.add(id)
      byId.get(id)?.replaces.forEach(add)
    }
  }
  for (const f of historical) f.replaces.forEach(add)
  const facts = pool
    .filter((f) => wanted.has(f.id))
    .map((fact) => (replaceable.has(fact.id) || fact.status !== 'active' ? fact : { ...fact, stillActive: false }))
  const entities = state.entities.filter((e) => related.has(e.id) || facts.some((f) => f.subjects.includes(e.id)))
  return { entities, facts }
}

/** References must resolve to supplied records; every assertion retains a verbatim source. */
export function parseChapterMemory(
  raw: unknown,
  opts: {
    novelId: string
    chapterId: string
    ordinal: number
    text: string
    part: number
    previous: LedgerState
    supplied: LedgerState
  },
): ChapterMemory {
  const root = object(raw)
  if (!Array.isArray(root.entities) || !Array.isArray(root.facts)) return fail('缺少 entities 或 facts')
  const entities = new Map(opts.previous.entities.map((e) => [e.id, { ...e, aliases: [...e.aliases] }]))
  const changed: MemoryEntity[] = []
  const declaredNames = new Set(root.entities.map((value) => str(object(value).name, 60, '实体名称')))
  for (const value of root.entities) {
    const item = object(value),
      name = str(item.name, 60, '人物/实体姓名')
    const aliases = strings(item.aliases, 12, 'aliases').filter((n) => n !== name)
    const mappedKind = coerceEntityKind(item.kind, name)
    const kind = enumValue(mappedKind, ['person', 'item', 'place', 'faction'] as const, '实体类别')
    const known = [...entities.values()].filter((e) => [e.name, ...e.aliases].includes(name))
    if (known.length > 1) return fail(`「${name}」存在身份歧义`)
    const existing = known[0]
    if (existing && existing.kind !== kind) return fail(`「${name}」的实体类别冲突`)
    // 模型给出的身份说明：逐字取自正文则保留；只差排版噪音则按正文原样落库；
    // 正文根本没有说明时不再整章拒收（模型常给出空串，但这只影响别名证据的丰富度，
    // 别名本身仍要求逐字出现在正文），仅在别名确实无来源时退回。
    const rawEvidence = typeof item.identityQuote === 'string' ? item.identityQuote.trim() : ''
    const sourceEvidence = rawEvidence ? sourceSpan(opts.text, rawEvidence) : ''
    if (!existing && !opts.text.includes(name) && !canonicalNameGrounded(name, opts.text))
      // 规范名可以不是正文原词，但「人名 + 亲属关系」必须都能在正文核对；
      // 命中的代词补全名按低置信保留（证据可空），完全不成立于正文的名字照旧拒收。
      return fail(`新增实体「${name}」不在本章正文（代词补全的名称须附 identityQuote 说明身份）`)
    for (const alias of aliases) {
      if (alias.length > 60) return fail(`别名「${alias}」超过 60 字符`)
      if (declaredNames.has(alias)) return fail(`别名「${alias}」同时被声明为另一实体，请先核对身份`)
      if (!opts.text.includes(alias) && !existing?.aliases.includes(alias)) return fail(`别名「${alias}」缺少正文来源`)
      if ([...entities.values()].some((e) => e.id !== existing?.id && [e.name, ...e.aliases].includes(alias))) return fail(`别名「${alias}」与其他实体冲突`)
      if (!existing?.aliases.includes(alias) && !sourceEvidence && !opts.text.includes(alias)) return fail(`别名「${alias}」缺少可核对的身份说明`)
    }
    const entity: MemoryEntity = existing
      ? { ...existing, aliases: [...new Set([...existing.aliases, ...aliases])] }
      : { id: `e_${ledgerHash([opts.novelId, kind, name]).slice(0, 24)}`, name, aliases, kind }
    const newAliases = aliases.filter((alias) => !existing?.aliases.includes(alias))
    if (newAliases.length && sourceEvidence)
      entity.aliasEvidence = [
        ...(existing?.aliasEvidence || []),
        ...newAliases.map((alias) => ({ alias, quote: sourceEvidence, chapterId: opts.chapterId, ordinal: opts.ordinal })),
      ]
    entities.set(entity.id, entity)
    changed.push(entity)
  }
  const nameId = (name: string) => {
    const matches = [...entities.values()].filter((e) => [e.name, ...e.aliases].includes(name))
    if (matches.length !== 1) return fail(`实体「${name}」未声明或有歧义`)
    return matches[0]!.id
  }
  const supplied = new Map(opts.supplied.facts.map((f) => [f.id, f]))
  const alreadyReplaced = new Set(opts.previous.facts.flatMap((f) => f.replaces))
  const facts: MemoryFact[] = root.facts.map((value, index) => {
    const item = object(value)
    const memoryType = enumValue(item.memoryType, ['state', 'event'] as const, 'memoryType')
    const kind = enumValue(coerceFactKind(item.kind, item), ['fact', 'state', 'relationship', 'boundary', 'clue', 'conflict', 'item', 'place'] as const, '事实类别')
    const label = str(item.label, 80, 'label')
    const subjects = strings(item.subjects, 12, 'subjects').map(nameId)
    if (!subjects.length || (kind === 'relationship' && subjects.length !== 2)) return fail('事实必须绑定实体，关系必须绑定双方')
    const quote = str(item.quote, 1000, 'quote')
    const span = sourceSpan(opts.text, quote)
    if (!span) return fail(`facts[${index}].quote 无法逐字匹配本章正文（引文须为本段连续原文）`)
    const certainty = enumValue(
      lenientEnum(item.certainty, ['fact', 'belief', 'clue', 'possibility', 'inference'] as const, 'certainty') ?? item.certainty,
      ['fact', 'belief', 'clue', 'possibility', 'inference'] as const,
      'certainty',
    )
    const perspective = item.perspective ? nameId(str(item.perspective, 60, 'perspective')) : undefined
    if (certainty === 'belief' && (!perspective || !subjects.includes(perspective))) return fail('人物认知必须注明认知主体并绑定该实体')
    if (certainty !== 'belief' && perspective) return fail(`facts[${index}]「${label}」：只有人物认知可设置 perspective（当前 certainty=${certainty}）`)
    const replaces = strings(item.replaces, 30, 'replaces')
    // 人物认知、线索、冲突、关系、边界是「种一次」的主题：新记录不能顺手改主题，
    // 普通状态（地点、归属、目标）允许模型收敛措辞。
    const onceOnly = ['belief', 'clue', 'conflict', 'relationship', 'boundary'].includes(kind) || certainty === 'belief'
    if (kind === 'relationship' && typeof item.directed !== 'boolean') return fail('关系必须明确 directed 方向')
    for (const id of replaces) {
      const before = supplied.get(id)
      if (!before) return fail(`替换记录 ${id} 不属于本次提供的同主题、同核心主体、同类别有效状态`)
      const beforeKind = String(before.kind ?? '')
      const shared = before.subjects.filter((subject) => subjects.includes(subject))
      const sameSubjects = [...before.subjects].sort().join() === [...subjects].sort().join()
      // 物品归属认物品、位置认人物，主体集合会随转手/移动而变化，因此物品与地点类只要
      // 仍有共有主体即可承接；其余主题要求核心主体完全一致。
      // 此外，当人物主观猜想/认知被正文证实为客观事实时，认知者主体可能不再参与客观事实，允许共有主体承接。
      const isBeliefConfirmed = before.certainty === 'belief' && certainty === 'fact' && !perspective
      const anchoredByTopic =
        ['item', 'place'].includes(beforeKind) || ['item', 'place'].includes(kind) || isBeliefConfirmed
          ? shared.length > 0
          : sameSubjects
      const sameSide = before.subjects.join() === subjects.join()
      const stale = (before as MemoryFact & { supplied?: boolean }).supplied === false
      // 只能替换本轮派发给模型、且仍是当前状态、认知口径一致的记录。
      if (stale || alreadyReplaced.has(id) || before.memoryType !== 'state' || memoryType !== 'state')
        return fail(`替换记录 ${id} 不属于本次提供的同主题、同核心主体、同类别有效状态`)
      if (!anchoredByTopic) return fail(`替换记录 ${id} 不属于本次提供的同主题、同核心主体、同类别有效状态（缺少共有核心主体）`)
      if (before.directed && item.directed === true && !sameSide)
        return fail(`替换记录 ${id} 不属于本次提供的同主题、同核心主体、同类别有效状态（单向关系不能改方向）`)
      const samePerspective = isBeliefConfirmed || ((before.certainty === 'belief') === (certainty === 'belief') && before.perspective === perspective)
      if (!samePerspective)
        return fail(`替换记录 ${id} 不属于本次提供的同主题、同核心主体、同类别有效状态（认知口径不同）`)
      // 类别只放宽状态类互换：关系与边界仍须严格同类别，避免把关系维度替换成整体关系。
      const RELAXABLE = ['fact', 'state', 'clue', 'conflict', 'item', 'place']
      if (before.kind !== kind && !(RELAXABLE.includes(before.kind) && RELAXABLE.includes(kind)))
        return fail(`替换记录 ${id} 的类别变化超出放宽范围（原类别 ${before.kind} → ${kind}）`)
      // label 是持久主题：人物认知、线索、冲突、关系、边界不许顺手改主题，普通状态允许收敛措辞。
      if (before.label !== label && (certainty === 'inference' || onceOnly))
        return fail(`替换记录 ${id} 的主题变化过大（原主题「${before.label}」），请沿用旧 label 或另开新记录`)
      alreadyReplaced.add(id)
    }
    return {
      id: `f_${ledgerHash([opts.novelId, opts.chapterId, opts.part, index, item]).slice(0, 24)}`,
      memoryType,
      kind,
      subjects,
      label,
      summary: str(item.summary, 1000, 'summary'),
      certainty,
      ...(kind === 'relationship' ? { directed: item.directed as boolean } : {}),
      ...(perspective ? { perspective } : {}),
      status: enumValue(item.status, ['active', 'resolved'] as const, 'status'),
      scope: enumValue(item.scope, ['local', 'global'] as const, 'scope'),
      replaces,
      quote: span,
      chapterId: opts.chapterId,
      ordinal: opts.ordinal,
    }
  })
  return { version: 1, entities: changed, facts }
}

export function applyChapterMemory(state: LedgerState, chapter: ChapterMemory): LedgerState {
  const entities = new Map(state.entities.map((e) => [e.id, e]))
  for (const e of chapter.entities) entities.set(e.id, e)
  return { entities: [...entities.values()], facts: [...state.facts, ...chapter.facts] }
}

const certaintyLabels = { fact: '已确认事实', belief: '人物认知', clue: '未解线索', possibility: '可选方向', inference: '分析推断' }
export function factLine(fact: MemoryFact, state: LedgerState): string {
  const names = fact.subjects.map((id) => state.entities.find((e) => e.id === id)?.name || id).join('、')
  const perspective = fact.perspective ? `（${state.entities.find((e) => e.id === fact.perspective)?.name}所知）` : ''
  return `${fact.memoryType === 'event' ? '【章节事件】' : ''}【${certaintyLabels[fact.certainty]}】${names}${perspective}｜${fact.label}：${fact.summary}${fact.status === 'resolved' ? '（已解决）' : ''} [章节ID:${fact.chapterId}]`
}
export function renderLedger(state: LedgerState, kind: 'plot' | 'relationship', includeHistory = false): string {
  const current = new Set(currentFacts(state).map((f) => f.id))
  const facts = (includeHistory ? state.facts : currentFacts(state)).filter((f) =>
    kind === 'relationship' ? ['relationship', 'boundary'].includes(f.kind) : !['relationship', 'boundary'].includes(f.kind),
  )
  const lines = facts.map((f) => `${current.has(f.id) ? '' : '【历史记录，已被后续状态更新】'}${factLine(f, state)}\n正文依据：${f.quote}`)
  const aliases = state.entities
    .filter((e) => e.aliases.length && facts.some((f) => f.subjects.includes(e.id)))
    .map(
      (e) => `实体别名：${e.name}（${e.aliases.join('、')}）${(e.aliasEvidence || []).map((a) => `\n身份依据：${a.quote} [章节ID:${a.chapterId}]`).join('')}`,
    )
  lines.unshift(...aliases)
  return lines.length ? lines.join('\n\n') : '本范围暂无已提取的相关记录。'
}

/** Derived from the same records as the archives; no second semantic extraction. */
export function ledgerGraph(state: LedgerState): StoryGraph | undefined {
  const facts = currentFacts(state)
  const states = [...workingFacts(state)].reverse()
  const evidence = (f: MemoryFact) => {
    const kind = (['relationship', 'boundary'].includes(f.kind) ? 'relationship' : 'plot') as 'relationship' | 'plot'
    const line = factLine(f, state)
    return line.length <= 1200
      ? [{ kind, quote: line, chapterIds: [f.chapterId] }]
      : [
          { kind, quote: line.slice(0, 1200), chapterIds: [] },
          { kind, quote: `[章节ID:${f.chapterId}]`, chapterIds: [f.chapterId] },
        ]
  }
  const people = state.entities
    .filter((e) => e.kind === 'person' && facts.some((f) => f.subjects.includes(e.id)))
    .map((e) => {
      const fact = states.find((f) => f.subjects.includes(e.id)) || [...facts].reverse().find((f) => f.subjects.includes(e.id))!
      return { id: e.id, name: e.name, aliases: e.aliases, summary: fact.summary, evidence: evidence(fact) }
    })
  const ids = new Set(people.map((p) => p.id))
  const relationships = facts
    .filter((f) => f.kind === 'relationship' && f.subjects.length === 2 && f.subjects.every((id) => ids.has(id)))
    .map((f) => ({
      id: f.id,
      from: f.subjects[0]!,
      to: f.subjects[1]!,
      label: f.label,
      summary: f.summary,
      directed: f.directed ?? true,
      certainty: f.certainty,
      evidence: evidence(f),
    }))
  const threads = facts
    .filter((f) => ['state', 'clue', 'conflict', 'item', 'place'].includes(f.kind))
    .map((f) => ({
      id: f.id,
      title: f.label,
      kind: f.kind as 'state' | 'clue' | 'conflict' | 'item' | 'place',
      people: f.subjects.filter((id) => ids.has(id)),
      summary: f.summary,
      certainty: f.certainty,
      evidence: evidence(f),
    }))
  return { version: 1, people, relationships, threads }
}
