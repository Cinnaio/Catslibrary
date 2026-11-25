import { AGENT_PLAN_BRANCH_LIMIT, AGENT_PLAN_BRANCH_NAME_LIMIT, type AgentChapterPlan, type AgentChapterPlanBranch, type AgentChapterPlanBranchState } from '@shared/ai-agent'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { parseChapterPlan } from './agent-chapter-plan'

type Session = { chapter_plan: AgentChapterPlan | null; active_task_id: string }
type Change = { kind: 'save'; name: string; expectedRevision: number } | { kind: 'select'; branchId: string; expectedRevision: number }
const conflict = (message: string) => new AiError('conflict', message, 409)
const invalid = (message: string) => new AiError('invalid', message, 422)
const sameContent = (a: AgentChapterPlan, b: AgentChapterPlan) => JSON.stringify([parseChapterPlan(a), a.sourceOutline, a.storyThreads]) === JSON.stringify([parseChapterPlan(b), b.sourceOutline, b.storyThreads])

function parseChange(value: unknown, branchId?: string): { requestId: string; change: Change } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('分支请求格式无效')
  const raw = value as Record<string, unknown>
  if (typeof raw.operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(raw.operationId)) throw invalid('分支请求标识无效')
  if (typeof raw.expectedRevision !== 'number' || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 1) throw invalid('请提供当前计划版本')
  if (branchId) return { requestId: raw.operationId, change: { kind: 'select', branchId, expectedRevision: raw.expectedRevision } }
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > AGENT_PLAN_BRANCH_NAME_LIMIT) throw invalid('请填写 1 至 60 字的分支名称')
  return { requestId: raw.operationId, change: { kind: 'save', name: raw.name.trim(), expectedRevision: raw.expectedRevision } }
}

async function scopedSession(db: DbClient, userId: string, sessionId: string, write: boolean) {
  const row = await first<Session>(db, 'SELECT chapter_plan,active_task_id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2 ' + (write ? 'FOR UPDATE' : 'FOR SHARE'), [sessionId, userId])
  if (!row) throw new AiError('invalid', '创作对话不存在', 404)
  return row
}
async function requireIdle(db: DbClient, userId: string, row: Session) {
  if (await first(db, "SELECT id FROM ai_tasks WHERE id=$1 AND user_id=$2 AND kind='agent_chat' AND status IN ('queued','running')", [row.active_task_id, userId]))
    throw conflict('助手正在处理消息，请等待或停止后操作分支')
}
async function listBranches(db: DbClient, sessionId: string): Promise<AgentChapterPlanBranch[]> {
  const rows = await all<AgentChapterPlanBranch>(db, 'SELECT id,name,plan,source,created_at AS "createdAt" FROM ai_agent_plan_branches WHERE session_id=$1 ORDER BY created_at DESC,id', [sessionId])
  return rows.map(row => ({ ...row, createdAt: Number(row.createdAt) }))
}
async function state(db: DbClient, sessionId: string, row: Session): Promise<AgentChapterPlanBranchState> {
  return { plan: row.chapter_plan, branches: await listBranches(db, sessionId) }
}
async function touch(db: DbClient, sessionId: string) {
  await db.query('UPDATE ai_agent_sessions SET updated_at=GREATEST(updated_at+1,$1) WHERE id=$2', [Date.now(), sessionId])
}
function requireCapacity(branches: AgentChapterPlanBranch[]) {
  if (branches.length >= AGENT_PLAN_BRANCH_LIMIT) throw conflict('已保存 8 个分支，请先移除不需要的分支，为当前计划留出保存位置')
}
async function insertBranch(db: DbClient, sessionId: string, name: string, plan: AgentChapterPlan, source: AgentChapterPlanBranch['source']) {
  const branch: AgentChapterPlanBranch = { id: newId('plan_branch'), name, plan, source, createdAt: Date.now() }
  await db.query('INSERT INTO ai_agent_plan_branches(id,session_id,name,plan,source,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
    [branch.id, sessionId, name, JSON.stringify(plan), source, branch.createdAt])
  return branch
}

export async function readPlanBranches(db: Db, userId: string, sessionId: string) {
  return withTx(db, async query => {
    const scoped = { query }
    return state(scoped, sessionId, await scopedSession(scoped, userId, sessionId, false))
  })
}

/** Capture only the saved server-side plan; clients cannot inject branch content or confirm writing. */
export async function changePlanBranch(db: Db, userId: string, sessionId: string, value: unknown, branchId?: string) {
  const { requestId, change } = parseChange(value, branchId)
  return withTx(db, async query => {
    const scoped = { query }
    const row = await scopedSession(scoped, userId, sessionId, true)
    const receipt = await first<{ payload: Change; branch_id: string }>(scoped, 'SELECT payload,branch_id FROM ai_agent_plan_branch_operations WHERE session_id=$1 AND request_id=$2', [sessionId, requestId])
    if (receipt) {
      // JSONB key order is not significant. Compare the request's explicit fields.
      if (receipt.payload.kind !== change.kind || receipt.payload.expectedRevision !== change.expectedRevision ||
        (change.kind === 'save' ? receipt.payload.kind !== 'save' || receipt.payload.name !== change.name : receipt.payload.kind !== 'select' || receipt.payload.branchId !== change.branchId))
        throw conflict('同一分支请求不能更换操作或内容')
      if (change.kind === 'save' && !await first(scoped, 'SELECT id FROM ai_agent_plan_branches WHERE session_id=$1 AND id=$2', [sessionId, receipt.branch_id]))
        throw conflict('这次请求保存的分支已被移除，请刷新列表')
      // A late retry reports current state without switching the plan back again.
      return state(scoped, sessionId, row)
    }
    await requireIdle(scoped, userId, row)
    const current = row.chapter_plan
    if (!current || current.revision !== change.expectedRevision) throw conflict('当前计划已变化，请刷新核对后再操作分支')
    const branches = await listBranches(scoped, sessionId)
    let branch: AgentChapterPlanBranch
    if (change.kind === 'save') {
      const existing = branches.find(item => item.name === change.name)
      if (existing && !sameContent(existing.plan, current)) throw conflict('已有同名分支，请换一个名称')
      if (!existing) requireCapacity(branches)
      branch = existing || await insertBranch(scoped, sessionId, change.name, current, 'saved')
    } else {
      const selected = branches.find(item => item.id === change.branchId)
      if (!selected) throw new AiError('invalid', '这个分支不存在或已被移除，请刷新列表', 404)
      branch = selected
      if (!sameContent(current, selected.plan)) {
        if (!branches.some(item => sameContent(item.plan, current))) {
          requireCapacity(branches)
          const base = ('切换前 · 第 ' + current.revision + ' 版 · ' + current.title).slice(0, AGENT_PLAN_BRANCH_NAME_LIMIT - 4)
          let name = base
          for (let i = 2; branches.some(item => item.name === name); i++) name = base + ' ' + i
          await insertBranch(scoped, sessionId, name, current, 'switch')
        }
        const plan: AgentChapterPlan = { ...parseChapterPlan(selected.plan), sourceOutline: selected.plan.sourceOutline, storyThreads: selected.plan.storyThreads, version: 1, revision: current.revision + 1, updatedAt: Date.now(), sourceBranch: { id: selected.id, name: selected.name } }
        await query("UPDATE ai_agent_sessions SET chapter_plan=$1::jsonb,chapter_plan_operation_id='' WHERE id=$2", [JSON.stringify(plan), sessionId])
        row.chapter_plan = plan
      }
    }
    await query('INSERT INTO ai_agent_plan_branch_operations(session_id,request_id,payload,branch_id,applied_revision,created_at) VALUES($1,$2,$3::jsonb,$4,$5,$6)',
      [sessionId, requestId, JSON.stringify(change), branch.id, row.chapter_plan!.revision, Date.now()])
    await touch(scoped, sessionId)
    return state(scoped, sessionId, row)
  })
}

export async function removePlanBranch(db: Db, userId: string, sessionId: string, branchId: string) {
  return withTx(db, async query => {
    const scoped = { query }
    const row = await scopedSession(scoped, userId, sessionId, true)
    await requireIdle(scoped, userId, row)
    const deleted = await query('DELETE FROM ai_agent_plan_branches WHERE session_id=$1 AND id=$2', [sessionId, branchId])
    if (deleted.rowCount) await touch(scoped, sessionId)
    // Deleting an immutable branch never changes the current plan or previous writing tasks.
    return state(scoped, sessionId, row)
  })
}
