import { createHash } from 'node:crypto'
import type { MemoryEntity, MemoryFact } from './story-ledger'
import { locationTopic, memoryTopic, ownershipItems, ownershipTopic, replacementProblem } from './story-ledger-integrity'

/** Identity contains no current value/holder/destination. Free-form topics must
 * still match exactly; no fuzzy label merging or last-write-wins for ambiguity. */
export function stateIdentity(fact: MemoryFact, entities: ReadonlyMap<string, MemoryEntity>): { key: string; singleton: boolean } | undefined {
  if (fact.memoryType !== 'state') return undefined
  const ofKind = (kind: MemoryEntity['kind']) => fact.subjects.filter((id) => entities.get(id)?.kind === kind).sort()
  let identity: unknown[] = [fact.kind === 'fact' ? 'state' : fact.kind, [...fact.subjects].sort(), memoryTopic(fact.label)]
  let singleton = false
  if (fact.certainty === 'belief') {
    identity = ['knowledge', fact.perspective, fact.subjects.filter((id) => id !== fact.perspective).sort(), memoryTopic(fact.label)]
  } else if (ownershipTopic(fact.label) && ['item', 'state', 'fact'].includes(fact.kind) && ownershipItems(fact, entities).length === 1) {
    identity = ['ownership', ownershipItems(fact, entities)]
    singleton = true
  } else if (locationTopic(fact.label) && ['place', 'state', 'fact'].includes(fact.kind) && ofKind('person').length === 1) {
    identity = ['location', ofKind('person')]
    singleton = true
  } else if (fact.kind === 'relationship') {
    identity = ['relationship', fact.directed ? fact.subjects : [...fact.subjects].sort(), fact.directed, memoryTopic(fact.label)]
  }
  return { key: `s_${createHash('sha256').update(JSON.stringify([fact.scope, fact.certainty, ...identity])).digest('hex').slice(0, 24)}`, singleton }
}

/** Reconcile only provided, active state. An unchanged duplicate adds no memory;
 * single-owner slots can advance deterministically, while semantic changes to
 * open topics require the model's explicit replacement edge. */
export function reconcileState(
  next: MemoryFact,
  current: MemoryFact[],
  supplied: ReadonlySet<string>,
  entities: ReadonlyMap<string, MemoryEntity>,
): { skip?: boolean; problem?: string } {
  const identity = stateIdentity(next, entities)
  if (!identity) return {}
  next.stateKey = identity.key
  const candidates = current.filter((before) => stateIdentity(before, entities)?.key === identity.key && !(next.resolves || []).includes(before.id))
  if (!candidates.length) return {}
  if (candidates.some((before) => !supplied.has(before.id))) return { problem: '同一状态的旧记录未在参考集中；请通过 needs 补查后再更新' }
  if (!next.replaces.length && !next.resolves?.length && candidates.every((before) =>
    before.status === next.status && before.kind === next.kind &&
    [...before.subjects].sort().join('\0') === [...next.subjects].sort().join('\0') &&
    memoryTopic(before.summary) === memoryTopic(next.summary),
  )) return { skip: true }
  if (!identity.singleton && !next.replaces.some((id) => candidates.some((before) => before.id === id)))
    return { problem: `同一状态 ${candidates.map((before) => before.id).join('、')} 已存在；没有变化请省略，发生变化须用 replaces 明确更新，不能另建重复状态` }
  for (const before of candidates) {
    const problem = replacementProblem(before, next, entities)
    if (problem) return { problem }
    if (!next.replaces.includes(before.id)) next.replaces.push(before.id)
  }
  return {}
}
