import { currentFacts, factLine, renderLedger, type LedgerState, type MemoryFact } from './story-ledger'

/** A writing-only projection. Stored records, archive revisions and extraction inputs stay intact. */
export function projectWritingState(state: LedgerState): LedgerState {
  const facts = currentFacts(state)
  const entities = new Map(state.entities.map((entity) => [entity.id, entity]))
  const keys = new Map<string, MemoryFact[]>()
  for (const fact of facts) {
    if (
      fact.memoryType !== 'state' ||
      fact.scope === 'global' ||
      !['state', 'item', 'place'].includes(fact.kind) ||
      !['fact', 'belief'].includes(fact.certainty)
    )
      continue
    let subjects = [...fact.subjects].sort()
    let topic = ['duplicate', fact.label.normalize('NFKC').trim(), fact.summary.normalize('NFKC').trim()]
    // A holder or destination can change without changing the state owner.
    const items = subjects.filter((id) => entities.get(id)?.kind === 'item')
    const people = subjects.filter((id) => entities.get(id)?.kind === 'person')
    if (items.length === 1 && /归属|持有人|保管人|保管者|当前持有/.test(fact.label)) {
      subjects = items
      topic = ['item-owner']
    } else if (people.length === 1 && /当前位置|目前位置|所在位置|所在地|所在地点/.test(fact.label)) {
      subjects = people
      topic = ['person-location']
    }
    // A broad identical label alone cannot prove that two states contradict.
    const key = JSON.stringify([fact.kind, subjects, topic, fact.certainty, fact.perspective || '', fact.directed ?? null])
    const group = keys.get(key) || []
    group.push(fact)
    keys.set(key, group)
  }
  const hidden = new Set<string>()
  const replacements = new Map<string, string[]>()
  for (const group of keys.values()) {
    const latest = group.reduce((max, fact) => Math.max(max, fact.ordinal), 0)
    const old = group.filter((fact) => fact.ordinal < latest).map((fact) => fact.id)
    old.forEach((id) => hidden.add(id))
    // Different observations within the same chapter are kept; no semantic guessing.
    for (const fact of group.filter((fact) => fact.ordinal === latest)) replacements.set(fact.id, old)
  }
  return {
    entities: state.entities,
    facts: facts
      .filter((fact) => !hidden.has(fact.id))
      .map((fact) => (replacements.get(fact.id)?.length ? { ...fact, replaces: [...new Set([...fact.replaces, ...replacements.get(fact.id)!])] } : fact)),
  }
}

export interface WritingMemoryQuery {
  context: string
  instruction: string
  maxCharacters?: number
}

/** Keep whole evidence records. Actor names identify current state, never all of their history. */
export function selectWritingLedger(state: LedgerState, query: WritingMemoryQuery) {
  const projected = projectWritingState(state)
  const effective = new Set(projected.facts.map((fact) => fact.id))
  const byId = new Map(projected.facts.map((fact) => [fact.id, fact]))
  const haystack = `${query.context}\n${query.instruction}`.toLocaleLowerCase()
  const names = new Set(state.entities.flatMap((entity) => [entity.name, ...entity.aliases]).map((name) => name.toLocaleLowerCase()))
  const actors = new Set(
    state.entities
      .filter((entity) => [entity.name, ...entity.aliases].some((name) => name.length >= 2 && haystack.includes(name.toLocaleLowerCase())))
      .map((entity) => entity.id),
  )
  const task = query.instruction.toLocaleLowerCase()
  const terms = [...new Set(query.instruction.match(/[\p{Script=Han}]{2,8}|[a-zA-Z0-9_]{2,32}/gu) || [])]
    .map((term) => term.toLocaleLowerCase())
    .filter((term) => !names.has(term))
  const latest = state.facts.reduce((max, fact) => Math.max(max, fact.ordinal), 0)
  const candidates = state.facts
    .flatMap((original) => {
      let fact = byId.get(original.id) || original
      const active = effective.has(fact.id) && fact.status === 'active' && fact.memoryType === 'state'
      const global = effective.has(fact.id) && fact.scope === 'global' && fact.status === 'active'
      if (!active && !global) fact = { ...fact, stillActive: false }
      const related = fact.subjects.some((id) => actors.has(id))
      const text = `${fact.label} ${fact.summary}`.toLocaleLowerCase()
      const exactTopic = fact.label.length >= 2 && task.includes(fact.label.toLocaleLowerCase())
      const explicit = exactTopic || terms.some((term) => text.includes(term))
      if (!global && !explicit && !(active && related)) return []
      const slot = active && related && /位置|所在地|所在地点|去向|归属|持有|保管/.test(fact.label)
      const important = active && related && (fact.certainty === 'belief' || ['clue', 'conflict', 'boundary'].includes(fact.kind))
      const score = global ? 10000 : exactTopic ? 900 : explicit ? 750 : slot ? 650 : important ? 550 : latest - fact.ordinal <= 3 ? 400 : 200
      return [{ fact, global, explicit, slot, important, related, score }]
    })
    .sort((a, b) => b.score - a.score || b.fact.ordinal - a.fact.ordinal || a.fact.id.localeCompare(b.fact.id))
  const selected: MemoryFact[] = []
  const actorCounts = new Map<string, number>()
  const limit = Math.max(1, query.maxCharacters ?? 24000)
  let characters = 0
  for (const item of candidates) {
    const { fact, global, explicit, slot, important } = item
    const cost = factLine(fact, state).length + fact.quote.length + 20
    const limitedByActor = !global && !explicit && !slot && !important && fact.subjects.some((id) => actors.has(id) && (actorCounts.get(id) || 0) >= 16)
    if (!global && (limitedByActor || characters + cost > limit)) continue
    selected.push(fact)
    characters += cost
    if (!global && !explicit && !slot && !important) for (const id of fact.subjects) actorCounts.set(id, (actorCounts.get(id) || 0) + 1)
  }
  const selectedState: LedgerState = { entities: state.entities, facts: selected.sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id)) }
  const materialCharacters = renderLedger(selectedState, 'plot', true).length + renderLedger(selectedState, 'relationship', true).length
  return {
    state: selectedState,
    selectionVersion: 1,
    retrievedFacts: selected.length,
    totalFacts: state.facts.length,
    omittedFacts: state.facts.length - selected.length,
    projectedSupersededFacts: currentFacts(state).length - projected.facts.length,
    materialCharacters,
    overBudget: materialCharacters > limit,
  }
}
