import { createHash } from 'node:crypto'
import type { StoryCertainty, StoryGraph } from '@shared/story-graph'
import { AiError } from './client'

export const LEDGER_VERSION = 1
/** Bump when extraction semantics change, without changing the stored JSON schema. */
export const LEDGER_PROMPT_VERSION = 3
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
export function relevantLedger(state: LedgerState, text: string, queries: string[] = [], historyMode: 'explicit' | 'topics' = 'explicit'): LedgerState {
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
  // History is expanded only for explicit supplementary queries, never merely
  // because the protagonist occurs in every chapter.
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
  const facts = state.facts.filter((f) => wanted.has(f.id))
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
    const kind = enumValue(item.kind, ['person', 'item', 'place', 'faction'] as const, '实体类别')
    const known = [...entities.values()].filter((e) => [e.name, ...e.aliases].includes(name))
    if (known.length > 1) return fail(`「${name}」存在身份歧义`)
    const existing = known[0]
    if (existing && existing.kind !== kind) return fail(`「${name}」的实体类别冲突`)
    if (!existing && !opts.text.includes(name)) return fail(`新增实体「${name}」不在本章正文`)
    for (const alias of aliases) {
      if (alias.length > 60) return fail(`别名「${alias}」超过 60 字符`)
      if (declaredNames.has(alias)) return fail(`别名「${alias}」同时被声明为另一实体，请先核对身份`)
      if (!opts.text.includes(alias) && !existing?.aliases.includes(alias)) return fail(`别名「${alias}」缺少正文来源`)
      if ([...entities.values()].some((e) => e.id !== existing?.id && [e.name, ...e.aliases].includes(alias))) return fail(`别名「${alias}」与其他实体冲突`)
      if (!existing?.aliases.includes(alias)) {
        const quote = str(item.identityQuote, 1000, '新增别名的 identityQuote')
        if (!opts.text.includes(quote) || !quote.includes(alias) || ![name, ...(existing?.aliases || [])].some((n) => quote.includes(n)))
          return fail(`别名「${alias}」缺少可核对的身份说明`)
      }
    }
    const entity: MemoryEntity = existing
      ? { ...existing, aliases: [...new Set([...existing.aliases, ...aliases])] }
      : { id: `e_${ledgerHash([opts.novelId, kind, name]).slice(0, 24)}`, name, aliases, kind }
    const newAliases = aliases.filter((alias) => !existing?.aliases.includes(alias))
    if (newAliases.length)
      entity.aliasEvidence = [
        ...(existing?.aliasEvidence || []),
        ...newAliases.map((alias) => ({ alias, quote: (item.identityQuote as string).trim(), chapterId: opts.chapterId, ordinal: opts.ordinal })),
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
    const kind = enumValue(item.kind, ['fact', 'state', 'relationship', 'boundary', 'clue', 'conflict', 'item', 'place'] as const, '事实类别')
    const label = str(item.label, 80, 'label')
    const subjects = strings(item.subjects, 12, 'subjects').map(nameId)
    if (!subjects.length || (kind === 'relationship' && subjects.length !== 2)) return fail('事实必须绑定实体，关系必须绑定双方')
    const quote = str(item.quote, 1000, 'quote')
    if (!opts.text.includes(quote)) return fail(`facts[${index}].quote 无法逐字匹配本章正文`)
    const certainty = enumValue(item.certainty, ['fact', 'belief', 'clue', 'possibility', 'inference'] as const, 'certainty')
    const perspective = item.perspective ? nameId(str(item.perspective, 60, 'perspective')) : undefined
    if (certainty === 'belief' && (!perspective || !subjects.includes(perspective))) return fail('人物认知必须注明认知主体并绑定该实体')
    if (certainty !== 'belief' && perspective) return fail(`facts[${index}]「${label}」：只有人物认知可设置 perspective（当前 certainty=${certainty}）`)
    const replaces = strings(item.replaces, 30, 'replaces')
    if (kind === 'relationship' && typeof item.directed !== 'boolean') return fail('关系必须明确 directed 方向')
    for (const id of replaces) {
      const before = supplied.get(id)
      const shared = before?.subjects.filter((subject) => subjects.includes(subject)) || []
      const sameSubjects = before && [...before.subjects].sort().join() === [...subjects].sort().join()
      const sameAnchor =
        kind === 'relationship' || kind === 'boundary'
          ? sameSubjects
          : kind === 'item'
            ? shared.some((subject) => entities.get(subject)?.kind === 'item')
            : kind === 'place'
              ? shared.some(
                  (subject) => entities.get(subject)?.kind === (before?.subjects.some((old) => entities.get(old)?.kind === 'person') ? 'person' : 'place'),
                )
              : shared.length > 0
      if (
        !before ||
        alreadyReplaced.has(id) ||
        before.memoryType !== 'state' ||
        memoryType !== 'state' ||
        before.label !== label ||
        before.kind !== kind ||
        (before.certainty === 'belief') !== (certainty === 'belief') ||
        before.perspective !== perspective ||
        !sameAnchor ||
        (before.directed && item.directed && before.subjects.join() !== subjects.join())
      )
        return fail(`替换记录 ${id} 不属于本次提供的同主题、同核心主体、同类别有效状态`)
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
      quote,
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
