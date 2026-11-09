import type { MemoryEntity, MemoryFact } from './story-ledger'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Conservative identity evidence. Co-occurrence, shared surnames and partial
 * names do not establish identity. Unrecognized wording requires review. */
export function aliasIdentityQuote(name: string, alias: string, text: string): string {
  if (!text.includes(name) || !text.includes(alias)) return ''
  const canonical = escapeRegExp(name)
  const alternative = escapeRegExp(alias)
  const space = '[\\s，,：:]*'
  const quotes = '[\\s“”"‘’「」『』：:]*'
  const statement = `(?:${canonical}${space}(?:又名|别名(?:是|为)?|化名(?:是|为)?|也叫|人称|唤作)${quotes}${alternative}|${alternative}${space}(?:原名(?:为|是)?|本名(?:为|是)?|真名(?:为|是)?)${quotes}${canonical})`
  // Match in the full source, so a clipped identityQuote cannot turn
  // “沈砚猜测林舟又名阿舟” or a question into an asserted identity.
  return new RegExp(`(?:^|[。！？；\\n])\\s*(${statement})(?=$|[“”"‘’「」『』]*[，,。！；\\n])`, 'u').exec(text)?.[1] || ''
}

export const aliasIdentityGrounded = (name: string, alias: string, text: string) => !!aliasIdentityQuote(name, alias, text)
const sameIds = (a: string[], b: string[]) => [...a].sort().join('\0') === [...b].sort().join('\0')
const topic = (value: string) => value.normalize('NFKC').replace(/[\s，,。:：、]/gu, '')
const ownershipTopic = (label: string) => /^(?:(?:持有|保管|拥有).+|.+?(?:归属|所有者|持有者|持有人|保管者|保管人|持有状态|保管状态))$/u.test(topic(label))
const locationTopic = (label: string) => /^(?:当前|所在|所处)?(?:位置|地点)$/u.test(topic(label))
const genericKind = (kind: MemoryFact['kind']) => kind === 'state' || kind === 'fact'

/** Validate a state transition against its stable owner and topic. Never infer
 * a replacement merely because two records mention the same character. */
export function replacementProblem(before: MemoryFact, next: MemoryFact, entities: ReadonlyMap<string, MemoryEntity>): string | undefined {
  if (before.memoryType !== 'state' || next.memoryType !== 'state' || before.status !== 'active') return '只能替换当前持续状态'
  const confirmedBelief = before.certainty === 'belief' && next.certainty === 'fact' && !next.perspective
  if (!confirmedBelief && (before.certainty !== next.certainty || before.perspective !== next.perspective)) return '认知口径不同'
  if (before.scope !== next.scope) return '状态范围不同'

  const idsOfKind = (fact: MemoryFact, kind: MemoryEntity['kind']) => fact.subjects.filter((id) => entities.get(id)?.kind === kind)
  // Older generic states may not list the item in subjects. Recover only an
  // explicitly named, already registered item from the stored summary/label;
  // the quote can contain other items and is deliberately not used here.
  const items = (fact: MemoryFact) => {
    const explicit = idsOfKind(fact, 'item')
    return explicit.length
      ? explicit
      : [...entities.values()]
          .filter((entity) => entity.kind === 'item' && [entity.name, ...entity.aliases].some((name) => `${fact.label} ${fact.summary}`.includes(name)))
          .map((entity) => entity.id)
  }
  const ownership = ownershipTopic(before.label) && ownershipTopic(next.label)
  const location = locationTopic(before.label) && locationTopic(next.label)
  const itemTransition = before.kind === 'item' || next.kind === 'item' || (ownership && (items(before).length > 0 || items(next).length > 0))
  const placeTransition = before.kind === 'place' || next.kind === 'place' || location
  const compatibleKind =
    before.kind === next.kind ||
    (genericKind(before.kind) && genericKind(next.kind)) ||
    (before.kind === 'boundary' && next.kind === 'fact') ||
    (itemTransition && [before.kind, next.kind].every((kind) => kind === 'item' || genericKind(kind))) ||
    (placeTransition && [before.kind, next.kind].every((kind) => kind === 'place' || genericKind(kind)))
  if (!compatibleKind) return '事实类别不同，请保留原状态并另建记录'

  if (before.kind === 'relationship' || next.kind === 'relationship') {
    if (!sameIds(before.subjects, next.subjects)) return '关系必须绑定固定双方'
    if (before.directed !== next.directed || (before.directed && before.subjects.join('\0') !== next.subjects.join('\0'))) return '单向关系不能改方向'
  } else if (before.kind === 'boundary' || next.kind === 'boundary') {
    if (!sameIds(before.subjects, next.subjects)) return '边界必须绑定同一组核心主体，涉及双方时须固定双方'
  } else if (itemTransition) {
    const previousItems = items(before)
    if (!previousItems.length || !sameIds(previousItems, items(next))) return '物品状态必须绑定同一物品'
    if (!ownership && !sameIds(before.subjects, next.subjects)) return '非归属主题的物品状态必须绑定同一组核心主体'
  } else if (placeTransition) {
    const people = idsOfKind(before, 'person')
    if (people.length) {
      if (!sameIds(people, idsOfKind(next, 'person'))) return '人物位置必须绑定同一人物'
    } else if (!sameIds(before.subjects, next.subjects)) return '地点状态必须绑定同一主体'
  } else if (!sameIds(before.subjects, next.subjects)) return '状态必须绑定同一组核心主体'
  const fixedTopic = ['relationship', 'boundary'].includes(before.kind) || ['relationship', 'boundary'].includes(next.kind)
  if (topic(before.label) !== topic(next.label) && (fixedTopic || (!(itemTransition && ownership) && !(placeTransition && location)))) {
    return '主题不同，请沿用原 label 或另建记录'
  }
  if (confirmedBelief && (!before.perspective || !next.subjects.includes(before.perspective))) return '确认认知时仍须保留原认知主体'
  return undefined
}
