import type { MemoryEntity, MemoryFact } from './story-ledger'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Conservative identity evidence. Co-occurrence, shared surnames and partial
 * names do not establish identity. Unrecognized wording requires review. */
export function aliasIdentityQuote(name: string, alias: string, text: string, places: string[] = []): string {
  if (!text.includes(name) || !text.includes(alias)) return ''
  const canonical = escapeRegExp(name)
  const alternative = escapeRegExp(alias)
  const space = '[\\s，,：:]*'
  const quotes = '[\\s“”"‘’「」『』：:]*'
  // A bounded occupational prefix may follow a declared, source-grounded place.
  // Arbitrary prose before the name is never accepted as an identity assertion.
  const locations = places.filter((place) => place.length <= 60 && text.includes(place) && !/猜|疑|说|称|传闻|假设|如果|并非/u.test(place)).map(escapeRegExp)
  const title = `(?:(?:${locations.length ? `(?:${locations.join('|')})?` : ''})(?:管理员|检修员|职员|船匠|船长|信使|医师|掌柜|队长))?`
  const statement = `(?:${title}${canonical}${space}(?:又名|别名(?:是|为)?|化名(?:是|为)?|也叫|人称|唤作)${quotes}${alternative}|${title}${alternative}${space}(?:原名(?:为|是)?|本名(?:为|是)?|真名(?:为|是)?)${quotes}${canonical})`
  // Match in the full source, so a clipped identityQuote cannot turn
  // “沈砚猜测林舟又名阿舟” or a question into an asserted identity.
  return new RegExp(`(?:^|[。！？；\\n])\\s*(${statement})(?=$|[“”"‘’「」『』]*[，,。！；\\n])`, 'u').exec(text)?.[1] || ''
}

export const aliasIdentityGrounded = (name: string, alias: string, text: string) => !!aliasIdentityQuote(name, alias, text)
const sameIds = (a: string[], b: string[]) => [...a].sort().join('\0') === [...b].sort().join('\0')
export const memoryTopic = (value: string) => value.normalize('NFKC').replace(/[\s，,。:：、]/gu, '')
const topic = memoryTopic
const ownershipTopic = (label: string) => /^(?:(?:持有|保管|拥有).*|.*?(?:归属|所有者|持有者|持有人|保管者|保管人|持有状态|保管状态))$/u.test(topic(label))
const locationTopic = (label: string) => /^(?:当前|所在|所处)?(?:位置|地点)$/u.test(topic(label))
const genericKind = (kind: MemoryFact['kind']) => kind === 'state' || kind === 'fact'

/** Validate a state transition against its stable owner and topic. Never infer
 * a replacement merely because two records mention the same character. */
export function replacementProblem(before: MemoryFact, next: MemoryFact, entities: ReadonlyMap<string, MemoryEntity>): string | undefined {
  if (before.memoryType !== 'state' || next.memoryType !== 'state' || before.status !== 'active') return '只能替换当前持续状态'
  if (before.certainty !== next.certainty || before.perspective !== next.perspective)
    return '认知口径不同；人物认知更新须保留 certainty=belief 和原 perspective，客观事实另建；线索得到答案用 resolves'
  if (before.certainty === 'belief' && next.status === 'resolved') return '人物认知不能因纠正而归档；请保存 active 的正确当前认知'
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
  // An ownership label needs an item anchor even when the model classified it
  // as a generic state and omitted every item entity. Otherwise the shared
  // holder would let unrelated possessions overwrite each other.
  const itemTransition = before.kind === 'item' || next.kind === 'item' || ownership
  const placeTransition = before.kind === 'place' || next.kind === 'place' || location
  const compatibleKind =
    before.kind === next.kind ||
    (before.certainty === 'belief' && [before.kind, next.kind].every((kind) => kind === 'clue' || genericKind(kind))) ||
    (genericKind(before.kind) && genericKind(next.kind)) ||
    (before.kind === 'boundary' && genericKind(next.kind)) ||
    (itemTransition && [before.kind, next.kind].every((kind) => kind === 'item' || genericKind(kind))) ||
    (placeTransition && [before.kind, next.kind].every((kind) => kind === 'place' || genericKind(kind)))
  if (!compatibleKind) return '事实类别不同；更新旧记录请沿用原 kind，不同事项另建记录'

  if (before.kind === 'relationship' || next.kind === 'relationship') {
    if (!sameIds(before.subjects, next.subjects)) return '关系必须绑定固定双方'
    if (before.directed !== next.directed || (before.directed && before.subjects.join('\0') !== next.subjects.join('\0'))) return '单向关系不能改方向'
  } else if (before.kind === 'boundary' || next.kind === 'boundary') {
    if (!sameIds(before.subjects, next.subjects)) return '边界必须绑定同一组核心主体，涉及双方时须固定双方'
  } else if (itemTransition) {
    const previousItems = items(before)
    const nextItems = items(next)
    if (!previousItems.length || !nextItems.length) return '物品状态必须绑定同一物品；缺少可核对的物品身份，请先声明对应物品实体'
    if (!sameIds(previousItems, nextItems)) return '物品状态必须绑定同一物品'
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
  return undefined
}

/** A resolution closes a question, not another person's knowledge or an event.
 * The answer is independently stored as a fact with an explicit history edge. */
export function resolutionProblem(before: MemoryFact, next: MemoryFact): string | undefined {
  if (before.memoryType !== 'state' || before.status !== 'active' || !['clue', 'conflict'].includes(before.kind) || before.certainty === 'belief')
    return 'resolves 只能解决当前线索或冲突；人物认知使用 replaces 更新，事件与历史记录不可关闭'
  if (next.memoryType !== 'state' || next.certainty !== 'fact' || next.perspective || !['fact', 'state', 'clue', 'conflict'].includes(next.kind))
    return '线索答案须为有正文依据的客观 state/fact，不得用人物猜测解决线索'
  if (before.scope !== next.scope || !sameIds(before.subjects, next.subjects) || topic(before.label) !== topic(next.label))
    return '解决线索须沿用原 subjects、label 和 scope；答案写入 summary，其他事项另建记录'
  return undefined
}

/** Recognize explicit cognitive wording only; never infer a knower from a quote
 * containing several people. This is a conservative guard, not semantic proof. */
export function cognitionProblem(fact: MemoryFact, entities: ReadonlyMap<string, MemoryEntity>): string | undefined {
  if (fact.memoryType !== 'state') return undefined
  const knowers = [...entities.values()].filter((entity) => entity.kind === 'person' && [entity.name, ...entity.aliases].some((name) =>
    new RegExp(`${escapeRegExp(name)}(?:现已|现在|仍然|仍|已经|还|尚|并|此前|暗自|却|都|也|明确|终于|并不|尚未|仍未|还未|不|未){0,3}(?:知道|知晓|得知|获知|以为|误以为|认为|相信|猜测|怀疑|误认|不知)`, 'u').test(fact.summary),
  ))
  if (fact.certainty !== 'belief' && (/认知|知情|所知|误认/u.test(fact.label) || knowers.length))
    return '人物认知须使用 certainty=belief 和 perspective；客观事实请另建，不能把知道或误认写成无主体事实'
  if (fact.certainty === 'belief') {
    if (fact.status !== 'active') return '人物认知须保留 active；误解纠正后保存当前知道什么'
    if (knowers.some((person) => person.id !== fact.perspective)) return '认知摘要包含其他认知者；请为每个人分别记录，不共享 perspective'
  }
  return undefined
}
