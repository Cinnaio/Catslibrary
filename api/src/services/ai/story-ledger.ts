import { createHash } from 'node:crypto'
import type { StoryCertainty, StoryGraph } from '@shared/story-graph'
import { AiError } from './client'
import { aliasIdentityQuote, cognitionProblem, ownershipItems, ownershipTopic, replacementProblem, resolutionProblem } from './story-ledger-integrity'
import { reconcileState } from './story-ledger-state'
import { continuedGoalProblem, goalEndingProblem, goalTopic, goalWording, isOpenGoal, summaryProblem, type GoalReview } from './story-ledger-goals'
import { entityNames, placePossessiveName, type SourceName } from './story-ledger-names'
import type { SemanticReview } from './story-ledger-review'

export const LEDGER_VERSION = 1
/** Bump when extraction semantics change, without changing the stored JSON schema. */
export const LEDGER_PROMPT_VERSION = 9
export type EntityKind = 'person' | 'item' | 'place' | 'faction'
export type FactKind = 'fact' | 'state' | 'relationship' | 'boundary' | 'clue' | 'conflict' | 'item' | 'place' | 'goal'
export interface MemoryEntity {
  id: string
  name: string
  aliases: string[]
  kind: EntityKind
  aliasEvidence?: Array<{ alias: string; quote: string; chapterId: string; ordinal: number }>
  sourceNames?: SourceName[]
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
  /** Explicitly closed questions/conflicts; their answers remain separate facts. */
  resolves?: string[]
  /** Server-derived identity of a state slot, independent of its current value. */
  stateKey?: string
  goalOutcome?: 'completed' | 'cancelled' | 'superseded'
  successor?: string
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
  goalReviews?: GoalReview[]
  semanticReviews?: Array<SemanticReview & { part: number }>
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
  // Knowledge has a single epistemic contract regardless of whether the model
  // calls it a clue or a generic state. Relationships keep their own topology.
  if (item.certainty === 'belief' && ['fact', 'state', 'clue', 'belief', 'cognition', 'knowledge'].includes(raw)) return 'state'
  if (['fact', 'state', 'relationship', 'boundary', 'clue', 'conflict', 'item', 'place', 'goal'].includes(raw)) return raw
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
  const replaced = new Set(state.facts.flatMap((f) => [...f.replaces, ...(f.resolves || [])]))
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
  const names = new Set(state.entities.flatMap(entityNames).map((n) => n.toLocaleLowerCase()))
  const terms = [
    ...new Set([
      ...queries.flatMap((q) => [q, ...(q.match(/[\p{Script=Han}]{2,8}|[a-zA-Z0-9_]{2,32}/gu) || [])]),
      ...state.facts.filter((f) => queries.some((q) => q.includes(f.label))).map((f) => f.label),
    ]),
  ].filter((term) => historyMode === 'explicit' || !names.has(term.toLocaleLowerCase()))
  const ids = new Set(state.entities.filter((e) => entityNames(e).some((n) => haystack.includes(n.toLocaleLowerCase()))).map((e) => e.id))
  const current = workingFacts(state)
  const direct = current.filter(
    (f) => f.subjects.some((id) => ids.has(id)) || terms.some((q) => `${f.label} ${f.summary}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())),
  )
  const related = new Set([...ids, ...direct.flatMap((f) => f.subjects)])
  const wanted = new Set(direct.map((f) => f.id))
  for (const f of current) if (f.scope === 'global' || f.kind === 'boundary' || isOpenGoal(f) || f.subjects.some((id) => related.has(id))) wanted.add(f.id)
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
      const fact = byId.get(id)
      if (fact) [...fact.replaces, ...(fact.resolves || [])].forEach(add)
    }
  }
  for (const f of historical) [...f.replaces, ...(f.resolves || [])].forEach(add)
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
  const declaredPlaces = [
    ...opts.previous.entities.filter((entity) => entity.kind === 'place').map((entity) => entity.name),
    ...root.entities.map(object).filter((item) => item.kind === 'place').map(entityName),
  ].filter((name) => opts.text.includes(name))
  for (const value of root.entities) {
    const item = object(value)
    const rawName = entityName(item)
    const itemId = typeof item.id === 'string' ? item.id.trim() : ''
    const kind = enumValue(coerceEntityKind(item.kind, rawName), ['person', 'item', 'place', 'faction'] as const, '实体类别')
    const sourceName = item.sourceName === undefined ? undefined : str(item.sourceName, 100, 'sourceName')
    const mapping = placePossessiveName(rawName, kind, opts.text, declaredPlaces, sourceName)
    if (sourceName !== undefined && !mapping) return fail(`实体「${rawName}」的 sourceName 不符合地点加物品的有限来源映射`)
    const name = mapping?.canonical || rawName
    const aliases = strings(item.aliases === undefined ? [] : item.aliases, 12, 'aliases').filter((alias) => alias !== name)
    const known = [...entities.values()].filter((entity) => entityNames(entity).includes(name) || (mapping && entityNames(entity).includes(mapping.source)))
    if (known.length > 1) return fail(`「${name}」存在身份歧义`)
    const existing = known[0]
    if (itemId && (!existing || existing.id !== itemId)) return fail(`实体「${name}」的 ID 与已知身份不一致`)
    if (existing && existing.kind !== kind) return fail(`实体「${name}」的类别与已知身份不一致`)
    if (!existing && !mapping && !opts.text.includes(name) && !canonicalNameGrounded(name, opts.text)) {
      return fail(`新增实体「${name}」不在本章正文，无法确认身份`)
    }
    const newAliases = aliases.filter((alias) => alias !== existing?.name && !existing?.aliases.includes(alias))
    const aliasEvidence: NonNullable<MemoryEntity['aliasEvidence']> = []
    for (const alias of newAliases) {
      if (alias.length > 60) return fail('别名过长')
      if (declaredNames.has(alias) || [...entities.values()].some((entity) => entity.id !== existing?.id && entityNames(entity).includes(alias))) {
        return fail(`别名「${alias}」与另一实体冲突`)
      }
      const identity = aliasIdentityQuote(existing?.name || name, alias, opts.text, declaredPlaces)
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
    if (mapping) entity.sourceNames = [...(existing?.sourceNames || []), { text: mapping.source, rule: 'place-possessive', chapterId: opts.chapterId, ordinal: opts.ordinal }]
    entities.set(entity.id, entity)
    changed.push(entity)
  }
  const nameId = (value: string): string => {
    const name = value.trim()
    if (entities.has(name)) return name
    const matches = [...entities.values()].filter((entity) => entityNames(entity).includes(name))
    if (matches.length !== 1) return fail(`实体「${name}」未声明或身份有歧义`)
    return matches[0]!.id
  }
  const supplied = new Map(opts.supplied.facts.map((fact) => [fact.id, fact]))
  const replaceable = new Set(workingFacts(opts.previous).map((fact) => fact.id))
  const activeStates = workingFacts(opts.previous)
  const replacedThisChapter = new Set<string>()
  const facts: MemoryFact[] = []
  if (root.goals !== undefined && !Array.isArray(root.goals)) return fail('goals 必须为数组')
  const inputFacts = root.facts.map(object)
  if (inputFacts.some((item) => item.kind === 'goal')) return fail('新目标只填 goals 的 subjects、objective、quote；进度另填 facts，不能直接提交 kind=goal')
  for (const value of (root.goals || []) as unknown[]) {
    const item = object(value)
    if (Object.keys(item).some((key) => !['subjects', 'objective', 'quote'].includes(key)))
      return fail('goals 只接受 subjects、objective、quote；摘要和状态由程序生成，执行进度另存 facts')
    const rawObjective = str(item.objective, 80, 'goals.objective')
    const objective = goalTopic(rawObjective)
    if (!objective || /[，,。；;\n]/u.test(rawObjective) || /(?:(?:尚未|还未|未)(?:开始|动工|执行|完成)|进行中)$/u.test(objective))
      return fail('goals.objective 只写动作与对象、必要完成条件，不夹带执行进度')
    const actors = [...new Set(strings(item.subjects, 12, 'goals.subjects').map(nameId))]
    if (!actors.length || actors.some((id) => entities.get(id)?.kind !== 'person')) return fail('goals.subjects 必须绑定明确的人物执行者')
    inputFacts.push({
      subjects: actors, label: objective, summary: `${actors.map((id) => entities.get(id)!.name).join('、')}计划${objective}。`, quote: item.quote,
      memoryType: 'state', kind: 'goal', certainty: 'fact', status: 'active', scope: 'local', replaces: [],
    })
  }
  for (let index = 0; index < inputFacts.length; index++) {
    const item = inputFacts[index]!
    const memoryType = enumValue(item.memoryType, ['state', 'event'] as const, 'memoryType')
    const kind = enumValue(coerceFactKind(item.kind, item), ['fact', 'state', 'relationship', 'boundary', 'clue', 'conflict', 'item', 'place', 'goal'] as const, '事实类别')
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
    if (kind === 'relationship' && subjects.length === 1)
      return fail('关系必须绑定两个不同实体；规范名与已核实别名是同一人，身份只放 entities.aliases，不另建自身关系')
    if (kind === 'relationship' && (subjects.length !== 2 || typeof item.directed !== 'boolean')) return fail('关系必须绑定双方并明确 directed 方向')
    const status = enumValue(lenientEnum(item.status, ['active', 'resolved'], 'status'), ['active', 'resolved'] as const, 'status')
    const scope = enumValue(lenientEnum(item.scope, ['local', 'global'], 'scope'), ['local', 'global'] as const, 'scope')
    const replaces = item.replaces === undefined ? [] : strings(item.replaces, 30, 'replaces')
    const resolves = item.resolves === undefined ? [] : strings(item.resolves, 30, 'resolves')
    const next: MemoryFact = {
      id: `f_${ledgerHash([opts.novelId, opts.chapterId, opts.part, index, item]).slice(0, 24)}`,
      memoryType, kind, subjects, label, summary, certainty,
      ...(kind === 'relationship' ? { directed: item.directed as boolean } : {}),
      ...(perspective ? { perspective } : {}),
      status, scope, replaces: [...replaces], ...(resolves.length ? { resolves } : {}), quote, chapterId: opts.chapterId, ordinal: opts.ordinal,
    }
    const cognitiveProblem = cognitionProblem(next, entities)
    if (cognitiveProblem) return fail(`facts[${index}] ${cognitiveProblem}`)
    const contentProblem = summaryProblem(next, entities)
    if (contentProblem) return fail(`facts[${index}] ${contentProblem}`)
    if (kind === 'goal' && (memoryType !== 'state' || certainty !== 'fact' || status !== 'active' || scope !== 'local' || replaces.length || resolves.length))
      return fail('新目标须为 local、active、fact 的独立 state，旧目标结束只通过 goalReviews 提交')
    if (memoryType === 'state' && certainty !== 'belief' && kind !== 'goal' && goalWording(label, summary))
      return fail('目标或计划必须填写 goals；不能通过改类别绕过 goalReviews')
    if (memoryType === 'state' && certainty === 'fact' && ownershipTopic(label) && ['item', 'state', 'fact'].includes(kind)) {
      const items = ownershipItems(next, entities)
      // An item explicitly named in the summary/label is not a guessed entity.
      if (items.length === 1 && !next.subjects.includes(items[0]!)) next.subjects.push(items[0]!)
    }
    for (const id of [...replaces, ...resolves]) {
      const before = supplied.get(id)
      if (!before || !replaceable.has(id) || before.stillActive === false || replacedThisChapter.has(id)) {
        return fail(`替换记录 ${id} 不是本次提供的当前有效状态；历史依据不能作为替换目标`)
      }
      if (before.kind === 'goal') return fail(`目标 ${id} 只能通过 goalReviews 结束，不能改标签或类别替换`)
      const problem = replaces.includes(id) ? replacementProblem(before, next, entities) : resolutionProblem(before, next)
      if (problem) return fail(`替换记录 ${id} 无效（${problem}）`)
      replacedThisChapter.add(id)
    }
    const reconciliation = reconcileState(next, activeStates, new Set(supplied.keys()), entities)
    if (reconciliation.problem) return fail(`facts[${index}] ${reconciliation.problem}`)
    if (reconciliation.skip) continue
    if (next.stateKey && facts.some((fact) => fact.stateKey === next.stateKey))
      return fail(`facts[${index}] 同一段不能重复提交同一状态；请合并为本段结束时的状态，经过另记 event`)
    // Include deterministic singleton replacements in the same atomic conflict check.
    for (const id of next.replaces.filter((id) => !replaces.includes(id))) {
      if (replacedThisChapter.has(id)) return fail(`替换记录 ${id} 在本段被重复更新`)
      replacedThisChapter.add(id)
    }
    facts.push(next)
  }
  const goals = activeStates.filter(isOpenGoal)
  if (root.goalReviews !== undefined && !Array.isArray(root.goalReviews)) return fail('goalReviews 必须为数组')
  const reviews: GoalReview[] = []
  for (const value of (root.goalReviews || []) as unknown[]) {
    const item = object(value)
    const id = str(item.id, 100, 'goalReviews.id')
    const goal = goals.find((candidate) => candidate.id === id)
    if (!goal || !supplied.has(id) || supplied.get(id)?.stillActive === false || reviews.some((review) => review.id === id))
      return fail(`目标复核 ${id} 不是唯一、已提供的当前目标`)
    const decision = enumValue(item.decision, ['continue', 'completed', 'cancelled', 'superseded'] as const, 'goalReviews.decision')
    if (decision === 'continue') {
      const problem = continuedGoalProblem(goal, opts.text)
      if (problem) return fail(problem)
      if (item.successor) return fail('continue 不能指定替代目标')
      reviews.push({ id, decision })
      continue
    }
    const quote = sourceSpan(opts.text, str(item.quote, 1000, 'goalReviews.quote'))
    if (!quote) return fail('目标结束依据无法逐字匹配本段正文')
    const endingProblem = goalEndingProblem(decision, quote, goal, opts.text)
    if (endingProblem) return fail(endingProblem)
    const successorLabel = item.successor ? goalTopic(str(item.successor, 80, 'goalReviews.successor')) : undefined
    const successors = facts.filter((fact) => fact.kind === 'goal' && fact.label === successorLabel)
    if (decision === 'superseded' ? successors.length !== 1 : !!successorLabel) return fail('替代须引用本段唯一的新目标 label；其他结束决定不能指定 successor')
    const closed: MemoryFact = {
      ...goal, id: `f_${ledgerHash([opts.novelId, opts.chapterId, opts.part, id, decision, quote]).slice(0, 24)}`,
      status: 'resolved', goalOutcome: decision, summary: quote, replaces: [id], quote,
      chapterId: opts.chapterId, ordinal: opts.ordinal,
      ...(decision === 'superseded' ? { successor: successors[0]!.id } : {}),
    }
    delete closed.stillActive
    facts.push(closed)
    reviews.push({ id, decision, quote, ...(successorLabel ? { successor: successorLabel } : {}) })
  }
  const missing = goals.filter((goal) => !reviews.some((review) => review.id === goal.id))
  if (missing.length) return fail(`goalReviews 缺少当前目标 ${missing.map((goal) => goal.id).join('、')}；每项目标必须明确 continue、completed、cancelled 或 superseded，事件不能代替结束关联`)
  return { version: 1, entities: changed, facts, ...(reviews.length ? { goalReviews: reviews } : {}) }
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
  const outcome = fact.goalOutcome ? ({ completed: '目标已完成', cancelled: '目标已取消', superseded: '目标已被替代' })[fact.goalOutcome] : '已解决'
  return `${fact.memoryType === 'event' ? '【章节事件】' : ''}【${certaintyLabels[fact.certainty]}】${names}${perspective}｜${fact.label}：${fact.summary}${fact.status === 'resolved' ? `（${outcome}）` : ''} [章节ID:${fact.chapterId}]`
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
  lines.unshift(...state.entities.flatMap((entity) => facts.some((fact) => fact.subjects.includes(entity.id))
    ? (entity.sourceNames || []).map((source) => `名称来源：${source.text} → ${entity.name}（地点所属物品，单个“的”归一） [章节ID:${source.chapterId}]`) : []))
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
    .filter((f) => ['state', 'clue', 'conflict', 'item', 'place', 'goal'].includes(f.kind))
    .map((f) => ({
      id: f.id,
      title: f.label,
      kind: (f.kind === 'goal' ? 'clue' : f.kind) as 'state' | 'clue' | 'conflict' | 'item' | 'place',
      people: f.subjects.filter((id) => ids.has(id)),
      summary: f.summary,
      certainty: f.certainty,
      evidence: evidence(f),
    }))
  return { version: 1, people, relationships, threads }
}
