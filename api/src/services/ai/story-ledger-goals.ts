import type { MemoryEntity, MemoryFact } from './story-ledger'

export type GoalDecision = 'continue' | 'completed' | 'cancelled' | 'superseded'
export interface GoalReview {
  id: string
  decision: GoalDecision
  quote?: string
  successor?: string
}

/** Goals are reviewed independently of newly emitted fact labels/categories. */
export const isOpenGoal = (fact: MemoryFact) => fact.kind === 'goal' && fact.memoryType === 'state' && fact.status === 'active'
export const goalWording = (label: string, summary: string) =>
  /(?:目标|计划|待办|任务)$/u.test(label) || /(?:计划|打算|准备|决定|约定|提议).{0,24}(?:明日|次日|稍后|寻找|查明|前往|进城|上山|开门|开箱|检修|传话)/u.test(summary)
export const goalTopic = (label: string) => label.replace(/(?:的)?(?:目标|计划|任务|行动)$/u, '').replace(/[\s，,。]/gu, '')

/** A narrow contradiction guard, not a natural-language entailment checker.
 * Only an explicit repeated objective with an ending verb is actionable. */
export function continuedGoalProblem(goal: MemoryFact, text: string): string | undefined {
  const objective = goalTopic(goal.label)
  if (objective.length < 2) return undefined
  const escaped = objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const terminal = new RegExp(`(?:完成|取消|放弃|撤销|取代)了?${escaped}|${escaped}(?:的)?(?:目标|计划|任务)?(?:已经|现已|已|正式)?(?:完成|取消|放弃|撤销|被取代)`, 'u')
  for (const clause of text.split(/[。！？；\n]/u)) {
    if (terminal.test(clause) && !/尚未|没有|并未|未能|不能|不会|不要|不曾|能否|是否|如果|假如|打算|准备|回忆|想起|传闻|听说|猜测|明日|次日|将会/u.test(clause))
      return `目标 ${goal.id} 在本段有明确结束表述，不能 continue；请提供结束决定和原文依据`
  }
  return undefined
}

export function goalEndingProblem(decision: Exclude<GoalDecision, 'continue'>, quote: string, goal?: MemoryFact, text = quote): string | undefined {
  const markers = {
    completed: /完成|成功|修好|修完|抵达|到达|找到|查明|打开|交还|送达|告知|告诉|读完|已读|查清/u,
    cancelled: /取消|放弃|撤销|作废|不再/u,
    superseded: /改为|改成|取代|替代|改用|改走|改道|另定/u,
  }
  // Inspect the full containing source clause, so clipping "尚未完成..." to
  // "完成..." cannot manufacture completion evidence.
  const from = text.indexOf(quote)
  if (from < 0) return '目标结束引文不在原文中'
  const left = text.slice(0, from).split(/[，,。！？；\n]/u).at(-1) || ''
  const right = text.slice(from + quote.length).split(/[，,。！？；\n]/u)[0] || ''
  const clauses = `${left}${quote}${right}`.split(/[，,。！？；\n]/u).filter((clause) => markers[decision].test(clause))
  const asserted = clauses.filter((clause) => !/尚未|没有|并未|未能|能否|是否|如果|假如|打算|准备|回忆|想起|传闻|听说|猜测|明日|次日|将会/u.test(clause))
  if (!asserted.length) return '目标结束依据缺少明确的当前结束动作；不能以未完成、未来、回忆、传闻或无关引文关闭目标'
  if (goal) {
    const topic = goalTopic(goal.label)
    const action = /^(寻找|查明|前往|检修|更换|修理|修复|打开|送达|归还|交还|阅读|整理|等待|通知|告诉|调查)/u.exec(topic)?.[1]
    const object = action ? topic.slice(action.length) : topic
    if (object.length >= 2 && !asserted.some((clause) => clause.includes(object))) return '目标结束依据没有指向原目标对象；请引用能核对同一事项的原文'
  }
  return undefined
}

/** Detect obvious independent clauses mixed into a durable state. Belief
 * content can itself concern a location; it is not a second location fact. */
export function summaryProblem(fact: MemoryFact, entities: ReadonlyMap<string, MemoryEntity>): string | undefined {
  if ([...fact.summary.matchAll(/(?<!其)[她他它](?!人|处|物|事|日)/gu)].some(([pronoun]) => !fact.quote.includes(pronoun)))
    return '摘要新增了引文未支持的代词指代；请使用明确姓名或物品名，不推断性别'
  const numbers = fact.summary.match(/\d+(?:\.\d+)?/gu) || []
  if (numbers.some((value) => !fact.quote.includes(value))) return '摘要新增了引文未支持的数字；请核对数量与依据'
  if (fact.memoryType !== 'state') return undefined
  const clauses = fact.summary.split(/[，,；;。\n]/u).map((part) => part.trim()).filter(Boolean)
  const plan = /(?:计划|打算|准备|提议|决定|尚未执行|待执行)/u
  const progress = /(?:修好|修完|检修完成|完成检修|检修中|正在检修|开始检修|登记完|整理完)/u
  if (/^(?:当前|所在|所处)?(?:位置|地点)$/u.test(fact.label) && (plan.test(fact.summary) || progress.test(fact.summary)))
    return '位置摘要混入计划或进度；请拆开记录，位置只保留当前地点'
  if (fact.certainty === 'belief') {
    const person = entities.get(fact.perspective || '')
    const names = person ? [person.name, ...person.aliases] : []
    if (clauses.some((clause) => names.some((name) => clause.startsWith(name) && /^(?:仍然|仍|现在|目前|正|还)?在/u.test(clause.slice(name.length))) || plan.test(clause)))
      return '认知摘要混入认知者的位置或计划；请分开保存，认知只记录该人知道或不知道的具体事项'
  }
  return undefined
}
