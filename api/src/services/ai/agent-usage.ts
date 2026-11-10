import type { AgentSession, AgentTurnUsage } from '@shared/ai-agent'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'

/** Session ownership is enforced here too; do not infer linkage from timestamps. */
export async function readAgentTurnUsage(db: Db, userId: string, session: Pick<AgentSession, 'id'>, now = Date.now()): Promise<AgentTurnUsage[]> {
  const tasks = await all<{ id: string; status: AgentTurnUsage['status']; created_at: number; finished_at: number; tracked: boolean }>(
    db,
    `SELECT t.id,t.status,t.created_at,t.finished_at,(COALESCE(NULLIF(t.params,''),'{}')::jsonb->>'agentUsageVersion'='1') AS tracked
     FROM ai_agent_events e JOIN ai_agent_sessions s ON s.id=e.session_id JOIN ai_tasks t ON t.id=e.task_id
     WHERE t.kind='agent_chat' AND t.user_id=$1 AND s.user_id=$1 AND s.id=$2
       AND e.role='user' AND e.request_id IS NOT NULL
     ORDER BY t.created_at DESC,t.id DESC LIMIT 8`,
    [userId, session.id],
  )
  if (!tasks.length) return []
  const groups = await all<{
    task_id: string
    generation_type: string
    calls: number
    input_tokens: number
    output_tokens: number
    unknown_tokens: number
    unknown_cost: number
    currency: string
    cost: number
    cost_calls: number
  }>(
    db,
    `SELECT task_id,generation_type,COUNT(*)::int AS calls,SUM(prompt_tokens) AS input_tokens,SUM(completion_tokens) AS output_tokens,
       COUNT(*) FILTER (WHERE token_usage_reported IS NOT TRUE)::int AS unknown_tokens,
       COUNT(*) FILTER (WHERE cost_reported IS NOT TRUE)::int AS unknown_cost,
       COALESCE(cost_currency,'') AS currency,COALESCE(SUM(cost_millicents) FILTER (WHERE cost_reported),0) AS cost,
       COUNT(*) FILTER (WHERE cost_reported)::int AS cost_calls
     FROM ai_usage WHERE user_id=$1 AND task_id<>'' AND task_id=ANY($2::text[]) AND generation_type IN ('agent_chat','agent_summary')
     GROUP BY task_id,generation_type,cost_currency`,
    [userId, tasks.map((task) => task.id)],
  )
  return tasks.map((task) => {
    const result: AgentTurnUsage = {
      taskId: task.id,
      status: task.status,
      startedAt: Number(task.created_at),
      elapsedMs: Math.max(0, (Number(task.finished_at) || now) - Number(task.created_at)),
      tracked: !!task.tracked,
      chatCalls: 0,
      summaryCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      unknownTokenCalls: 0,
      costs: [],
      unknownCostCalls: 0,
    }
    const currencies = new Map<string, number>()
    for (const group of groups.filter((group) => group.task_id === task.id)) {
      result[group.generation_type === 'agent_summary' ? 'summaryCalls' : 'chatCalls'] += Number(group.calls)
      result.inputTokens += Number(group.input_tokens)
      result.outputTokens += Number(group.output_tokens)
      result.unknownTokenCalls += Number(group.unknown_tokens)
      result.unknownCostCalls += Number(group.unknown_cost)
      if (Number(group.cost_calls)) currencies.set(group.currency, (currencies.get(group.currency) || 0) + Number(group.cost) / 100000)
    }
    result.costs = [...currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount }))
    return result
  })
}
