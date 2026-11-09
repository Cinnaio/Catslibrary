import { createHash } from 'node:crypto'
import type { StoryCertainty, StoryGraph } from '@shared/story-graph'
import { AiError } from './client'
import { aliasIdentityQuote, replacementProblem } from './story-ledger-integrity'

export const LEDGER_VERSION = 1
/** Bump when extraction semantics change, without changing the stored JSON schema. */
export const LEDGER_PROMPT_VERSION = 5
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

/** 枚举字段的近义归一：模型偶尔把「事实类别」写成 event/关系别名，或将状态/范围写成近义词。 */
const ENUM_SYNONYMS: Record<string, string> = {
  event: 'fact',
  event_fact: 'fact',
  relationship_change: 'relationship',
  relation: 'relationship',
  relations: 'relationship',
  ongoing: 'active',
  current: 'active',
  open: 'active',
  in_progress: 'active',
  closed: 'resolved',
  ended: 'resolved',
  done: 'resolved',
  finished: 'resolved',
  scene: 'local',
  chapter: 'local',
  temporary: 'local',
  book: 'global',
  main: 'global',
  story: 'global',
  overall: 'global',
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

/** Only an explicit possessive phrase grounds a synthesized family name.
 * Two unrelated names/relationships appearing somewhere in a chapter do not. */
const RELATION_SUFFIX = /(父亲|母亲|爹爹|娘亲|爷爷|奶奶|外公|外婆|兄长|哥哥|弟弟|姐姐|妹妹|师父|师傅|师尊|弟子|徒弟|师兄|师姐|叔叔|婶婶|舅舅|姑母|表哥|表妹)$/u

export function canonicalNameGrounded(name: string, text: string): boolean {
  const suffix = name.match(RELATION_SUFFIX)?.[1]
  if (!suffix) return false
  const head = name.slice(0, -suffix.length)
  return head.length >= 2 && (text.includes(`${head}的${suffix}`) || text.includes(name))
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
  // Extraction normally receives only current active state, but an explicit
  // model history request must be able to inspect resolved/replaced records.
  // Those records are marked stale below and therefore can never be used as a
  // replacement target.
  const historical = state.facts.filter((f) =>
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
  const facts = state.facts
    .filter((f) => wanted.has(f.id))
    .map((fact) => (replaceable.has(fact.id) ? fact : { ...fact, stillActive: false }))
  const entities = state.entities.filter((e) => related.has(e.id) || facts.some((f) => f.subjects.includes(e.id)))
  return { entities, facts }
}

/** References must resolve exactly; formatting repair never discards semantics.
 * A chapter is atomic: any invalid entity, alias, fact or replacement stops it. */
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
    /** Compatibility only; semantic validation is identical in every mode. */
    tolerant?: boolean
  },
): ChapterMemory {
  const root = object(raw)
  if (!Array.isArray(root.entities) || !Array.isArray(root.facts)) return fail('缺少 entities 或 facts')
  const entities = new Map(opts.previous.entities.map((e) => [e.id, { ...e, aliases: [...e.aliases] }]))
  const changed: MemoryEntity[] = []
  const entityName = (item: Record<string, unknown>) => {
    const known = typeof item.id === 'string' ? entities.get(item.id.trim()) : undefined
    return str(item.name === undefined || item.name === null || item.name === '' ? known?.name : item.name, 60, '人物/实体姓名')
  }
  const declaredNames = new Set(root.entities.map((value) => entityName(object(value))))
  for (const value of root.entities) {
    const item = object(value)
    const name = entityName(item)
    const itemId = typeof item.id === 'string' ? item.id.trim() : ''
    const aliases = strings(item.aliases === undefined ? [] : item.aliases, 12, 'aliases').filter((alias) => alias !== name)
    const kind = enumValue(coerceEntityKind(item.kind, name), ['person', 'item', 'place', 'faction'] as const, '实体类别')
    const known = [...entities.values()].filter((entity) => [entity.name, ...entity.aliases].includes(name))
    if (known.length > 1) return fail(`「${name}」存在身份歧义`)
    const existing = known[0]
    if (itemId && (!existing || existing.id !== itemId)) return fail(`实体「${name}」的 ID 与已知身份不一致`)
    if (existing && existing.kind !== kind) return fail(`实体「${name}」的类别与已知身份不一致`)
    if (!existing && !opts.text.includes(name) && !canonicalNameGrounded(name, opts.text)) {
      return fail(`新增实体「${name}」不在本章正文，无法确认身份`)
    }
    const newAliases = aliases.filter((alias) => alias !== existing?.name && !existing?.aliases.includes(alias))
    const aliasEvidence: NonNullable<MemoryEntity['aliasEvidence']> = []
    for (const alias of newAliases) {
      if (alias.length > 60) return fail('别名过长')
      if (declaredNames.has(alias) || [...entities.values()].some((entity) => entity.id !== existing?.id && [entity.name, ...entity.aliases].includes(alias))) {
        return fail(`别名「${alias}」与另一实体冲突`)
      }
      const identity = aliasIdentityQuote(existing?.name || name, alias, opts.text)
      if (!identity) {
        return fail(`别名「${alias}」缺少正文来源中的明确身份说明，请提供 identityQuote`)
      }
      aliasEvidence.push({
        alias,
        quote: identity,
        chapterId: opts.chapterId,
        ordinal: opts.ordinal,
      })
    }
    const entity: MemoryEntity = existing
      ? { ...existing, aliases: [...new Set([...existing.aliases, ...newAliases])] }
      : { id: `e_${ledgerHash([opts.novelId, kind, name]).slice(0, 24)}`, name, aliases, kind }
    if (newAliases.length) {
      entity.aliasEvidence = [
        ...(existing?.aliasEvidence || []),
        ...aliasEvidence,
      ]
    }
    entities.set(entity.id, entity)
    changed.push(entity)
  }
  const nameId = (value: string): string => {
    const name = value.trim()
    if (entities.has(name)) return name
    const matches = [...entities.values()].filter((entity) => [entity.name, ...entity.aliases].includes(name))
    if (matches.length !== 1) return fail(`实体「${name}」未声明或身份有歧义`)
    return matches[0]!.id
  }
  const supplied = new Map(opts.supplied.facts.map((fact) => [fact.id, fact]))
  const replaceable = new Set(workingFacts(opts.previous).map((fact) => fact.id))
  const replacedThisChapter = new Set<string>()
  const facts: MemoryFact[] = []
  for (let index = 0; index < root.facts.length; index++) {
    const item = object(root.facts[index])
    const memoryType = enumValue(item.memoryType, ['state', 'event'] as const, 'memoryType')
    const kind = enumValue(coerceFactKind(item.kind, item), ['fact', 'state', 'relationship', 'boundary', 'clue', 'conflict', 'item', 'place'] as const, '事实类别')
    const label = str(item.label, 80, 'label')
    const summary = str(item.summary, 1000, 'summary')
    const rawQuote = str(item.quote, 1000, 'quote')
    const quote = sourceSpan(opts.text, rawQuote)
    if (!quote) return fail(`facts[${index}].quote 无法逐字匹配本章正文（引文须为本段连续原文）`)
    const subjects = [...new Set(strings(item.subjects, 12, 'subjects').map(nameId))]
    if (!subjects.length) return fail('事实必须绑定实体')
    const certainty = enumValue(item.certainty, ['fact', 'belief', 'clue', 'possibility', 'inference'] as const, 'certainty')
    const perspective = item.perspective ? nameId(str(item.perspective, 100, 'perspective')) : undefined
    if (certainty === 'belief') {
      if (!perspective || entities.get(perspective)?.kind !== 'person') return fail('人物认知必须注明有效的人物认知主体')
      // Explicitly supplied, unambiguous perspective can safely complete subjects.
      if (!subjects.includes(perspective)) subjects.push(perspective)
    } else if (perspective) return fail('非人物认知不能填写 perspective')
    if (kind === 'relationship' && (subjects.length !== 2 || typeof item.directed !== 'boolean')) return fail('关系必须绑定双方并明确 directed 方向')
    const status = enumValue(lenientEnum(item.status, ['active', 'resolved'], 'status'), ['active', 'resolved'] as const, 'status')
    const scope = enumValue(lenientEnum(item.scope, ['local', 'global'], 'scope'), ['local', 'global'] as const, 'scope')
    const replaces = item.replaces === undefined ? [] : strings(item.replaces, 30, 'replaces')
    const next: MemoryFact = {
      id: `f_${ledgerHash([opts.novelId, opts.chapterId, opts.part, index, item]).slice(0, 24)}`,
      memoryType, kind, subjects, label, summary, certainty,
      ...(kind === 'relationship' ? { directed: item.directed as boolean } : {}),
      ...(perspective ? { perspective } : {}),
      status, scope, replaces, quote, chapterId: opts.chapterId, ordinal: opts.ordinal,
    }
    for (const id of replaces) {
      const before = supplied.get(id)
      if (!before || !replaceable.has(id) || before.stillActive === false || replacedThisChapter.has(id)) {
        return fail(`替换记录 ${id} 不是本次提供的当前有效状态；历史依据不能作为替换目标`)
      }
      const problem = replacementProblem(before, next, entities)
      if (problem) return fail(`替换记录 ${id} 无效（${problem}）`)
      replacedThisChapter.add(id)
    }
    facts.push(next)
  }
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
  const lines = facts.map((f) => {
    const prefix = !current.has(f.id) ? '【历史记录，已被后续状态更新】' : f.stillActive === false ? '【历史记录，仅作回顾依据】' : ''
    return `${prefix}${factLine(f, state)}\n正文依据：${f.quote}`
  })
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
