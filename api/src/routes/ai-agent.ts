import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AgentActionKind } from '@shared/ai-agent'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { AiError, isTextAiConfigured, textProvider } from '../services/ai/client'
import { clientIpFromContext } from '../services/ai/audit-context'
import { withProviderSnapshot } from '../services/ai/provider-snapshot'
import { getProviderPreset } from '../services/ai/provider-presets'
import { cancelAiTask, getAiTask } from '../services/ai/tasks'
import { validateWritingContentPreferences } from '../services/ai/writing-preferences'
import { runAgentTurn } from '../services/ai/agent'
import { confirmAgentAction, prepareAgentAction, readAgentArtifact, type AgentApi } from '../services/ai/agent-actions'
import {
  appendAgentEvent,
  beginAgentTurn,
  createAgentSession,
  getAgentSession,
  listAgentActions,
  listAgentSessions,
  publicAgentAction,
  readAgentEvents,
  requireAgentArtifact,
  type AgentActionRow,
} from '../services/ai/agent-store'
import { agentMemorySource, changeAgentMemory, createAgentMemory, getAgentSummary, listAgentMemories } from '../services/ai/agent-memory'

type Dispatch = (request: Request) => Response | Promise<Response>
function numberParam(value: string | undefined, max = 10000) {
  const n = Number(value || 0)
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(max, n) : 0
}

/** No network loopback and no privileged bypass: every business operation re-enters auth/CSRF/maintenance middleware. */
export function agentApiAdapter(request: Request, dispatch: Dispatch): AgentApi {
  return async (path, method = 'GET', body) => {
    if (!path.startsWith('/api/ai/') || path.startsWith('/api/ai/agent/')) throw new AiError('invalid', '不支持的内部操作', 422)
    const headers = new Headers(request.headers)
    for (const name of ['content-length', 'content-type', 'idempotency-key', 'x-idempotency-key', 'x-operation-id']) headers.delete(name)
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await dispatch(new Request(new URL(path, request.url), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    const data = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new AiError(response.status === 409 ? 'conflict' : 'invalid', String(data.error || '操作失败'), response.status)
    return data
  }
}

export function createAgentRoutes(dispatch: Dispatch) {
  const routes = new Hono<AuthEnv>()
  routes.use('*', requireAdmin())
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    return withProviderSnapshot(next)
  })
  routes.onError((err, c) => {
    if (err instanceof AiError)
      return c.json({ error: err.message, code: err.code }, (err.status >= 400 && err.status <= 599 ? err.status : 500) as ContentfulStatusCode)
    console.error('[ai-agent]', err)
    return c.json({ error: '创作助手暂时不可用，请稍后重试' }, 500)
  })
  routes.get('/sessions', async (c) => {
    const novelId = String(c.req.query('novelId') || '')
    return c.json(await listAgentSessions(getDb(), c.get('user').id, novelId, numberParam(c.req.query('offset'))))
  })
  routes.post('/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const session = await createAgentSession(getDb(), c.get('user').id, {
      novelId: String(body.novelId || ''),
      afterChapterId: String(body.afterChapterId || ''),
      brief: String(body.brief || ''),
      contentPreferences: body.contentPreferences,
    })
    return c.json({ session }, 201)
  })
  routes.get('/sessions/:id', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    const history = await readAgentEvents(db, session.id)
    const tasks = await all<{ task_id: string }>(db, 'SELECT task_id FROM ai_agent_artifacts WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12', [
      session.id,
    ])
    const artifacts = []
    for (const task of tasks) {
      try {
        artifacts.push(await readAgentArtifact(db, session, task.task_id))
      } catch (error) {
        if (!(error instanceof AiError && error.status === 404)) throw error
      }
    }
    return c.json({
      session,
      ...history,
      activeTask: session.activeTaskId ? (await getAiTask(db, session.activeTaskId)) || null : null,
      artifacts,
      actions: await listAgentActions(db, session.id),
      memories: (await listAgentMemories(db, c.get('user').id, session.novelId)).memories.filter((memory) => memory.status === 'active' || memory.status === 'pending'),
      summary: await getAgentSummary(db, session.id),
    })
  })
  routes.get('/sessions/:id/events', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    return c.json(await readAgentEvents(getDb(), session.id, numberParam(c.req.query('before'), Number.MAX_SAFE_INTEGER)))
  })
  routes.patch('/sessions/:id', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    const preferences = validateWritingContentPreferences(body.contentPreferences ?? session.contentPreferences)
    if (preferences.error) throw new AiError('invalid', preferences.error, 422)
    const brief = body.brief === undefined ? session.brief : String(body.brief)
    if (brief.length > 4000) throw new AiError('invalid', '创作约定最多 4000 字', 422)
    await withTx(db, async (query) => {
      await query('SELECT id FROM ai_agent_sessions WHERE id=$1 FOR UPDATE', [session.id])
      if (
        await first(
          { query },
          "SELECT 1 FROM ai_agent_sessions s JOIN ai_tasks t ON t.id=s.active_task_id WHERE s.id=$1 AND t.status IN ('queued','running')",
          [session.id],
        )
      )
        throw new AiError('conflict', '请先等待或停止当前回复，再调整会话设置', 409)
      if (
        !(await run(
          { query },
          'UPDATE ai_agent_sessions SET brief=$1,content_preferences=$2,updated_at=GREATEST(updated_at+1,$3) WHERE id=$4 AND updated_at=$5',
          [brief, JSON.stringify(preferences.preferences), Date.now(), session.id, Number(body.expectedUpdatedAt)],
        ))
      )
        throw new AiError('conflict', '会话已变化，请刷新后再保存', 409)
    })
    return c.json({ session: await getAgentSession(db, c.get('user').id, session.id) })
  })
  routes.get('/sessions/:id/memories', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    return c.json({ ...(await listAgentMemories(db, c.get('user').id, session.novelId, numberParam(c.req.query('offset'), Number.MAX_SAFE_INTEGER))), summary: await getAgentSummary(db, session.id) })
  })
  routes.get('/sessions/:id/memories/:memoryId/source', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    return c.json({ source: await agentMemorySource(db, c.get('user').id, session, c.req.param('memoryId')) })
  })
  routes.post('/sessions/:id/memories', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    return c.json({ memory: await createAgentMemory(db, c.get('user').id, session, {
      title: body.title,
      content: body.content,
    }) }, 201)
  })
  routes.patch('/sessions/:id/memories/:memoryId', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    if (!['edit', 'confirm', 'archive'].includes(body.operation)) throw new AiError('invalid', '记忆操作无效', 422)
    return c.json({ memory: await changeAgentMemory(db, c.get('user').id, session, c.req.param('memoryId'), {
      operation: body.operation,
      expectedRevision: body.expectedRevision,
      title: body.title,
      content: body.content,
    }) })
  })
  routes.post('/sessions/:id/messages', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    if (body.providerPresetId !== undefined && (typeof body.providerPresetId !== 'string' || body.providerPresetId.length > 160))
      throw new AiError('invalid', '模型预设标识无效', 422)
    const providerPresetId = body.providerPresetId || ''
    const preset = providerPresetId ? getProviderPreset(providerPresetId) : undefined
    if (preset && preset.scope !== 'text') throw new AiError('invalid', '对话请选择文本模型预设', 422)
    return withProviderSnapshot(
      async () => {
        if (!isTextAiConfigured()) throw new AiError('disabled', '请先在模型与服务中配置支持工具调用的文本模型', 503)
        const turn = await beginAgentTurn(db, c.get('user').id, session.id, String(body.content || ''), String(body.requestId || ''), {
          providerPresetId,
          model: textProvider().model,
        })
        if (turn.created) {
          const current = await getAgentSession(db, c.get('user').id, session.id)
          void runAgentTurn(db, current, turn.taskId, c.get('user').id, agentApiAdapter(c.req.raw, dispatch), {
            ipAddress: clientIpFromContext(c),
            userAgent: c.req.header('User-Agent'),
          }).catch((err) => console.error('[ai-agent] turn failed', err))
        }
        return c.json(turn, 202)
      },
      preset ? { text: { baseUrl: preset.baseUrl, apiKey: preset.apiKey, model: preset.model } } : undefined,
    )
  })
  routes.post('/sessions/:id/stop', async (c) => {
    const db = getDb()
    const session = await getAgentSession(db, c.get('user').id, c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    const taskId = String(body.taskId || session.activeTaskId)
    if (taskId !== session.activeTaskId) await requireAgentArtifact(db, session.id, taskId)
    const task = await getAiTask(db, taskId)
    if (task && task.kind !== 'agent_chat')
      await agentApiAdapter(c.req.raw, dispatch)(`/api/ai/tasks/${encodeURIComponent(task.id)}/cancel`, 'POST', { operationId: `agent_cancel_${task.id}` })
    else if (task) await cancelAiTask(db, task.id)
    await appendAgentEvent(
      db,
      session.id,
      'activity',
      task?.kind === 'agent_chat' ? '已停止本轮回复；已提交的生成任务可在产出区单独停止' : '已请求停止生成任务',
      taskId,
    )
    return c.json({ ok: true })
  })
  routes.get('/sessions/:id/artifacts/:taskId', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    return c.json(await readAgentArtifact(getDb(), session, c.req.param('taskId')))
  })
  routes.post('/sessions/:id/actions', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    const body = await c.req.json().catch(() => ({}))
    return c.json(
      { action: await prepareAgentAction(getDb(), session, body.kind as AgentActionKind, String(body.targetId || ''), String(body.title || '')) },
      201,
    )
  })
  routes.get('/sessions/:id/actions/:actionId', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    const action = await first<AgentActionRow>(getDb(), 'SELECT * FROM ai_agent_actions WHERE id=$1 AND session_id=$2', [c.req.param('actionId'), session.id])
    if (!action) throw new AiError('invalid', '操作记录不存在', 404)
    return c.json({ action: publicAgentAction(action) })
  })
  routes.post('/sessions/:id/actions/:actionId/confirm', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    return c.json({ action: await confirmAgentAction(getDb(), session, c.req.param('actionId'), agentApiAdapter(c.req.raw, dispatch)) })
  })
  routes.post('/sessions/:id/actions/:actionId/reject', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    const count = await run(getDb(), "UPDATE ai_agent_actions SET status='rejected',updated_at=$1 WHERE id=$2 AND session_id=$3 AND status='pending'", [
      Date.now(),
      c.req.param('actionId'),
      session.id,
    ])
    if (!count) throw new AiError('conflict', '操作已被处理', 409)
    await appendAgentEvent(getDb(), session.id, 'activity', '已放弃这次采纳操作', '', { actionId: c.req.param('actionId') })
    return c.json({ ok: true })
  })
  routes.get('/sessions/:id/covers/:candidateId', async (c) => {
    const session = await getAgentSession(getDb(), c.get('user').id, c.req.param('id'))
    const image = await first<{ data: Buffer; content_type: string }>(
      getDb(),
      'SELECT data,content_type FROM ai_cover_candidates WHERE id=$1 AND novel_id=$2',
      [c.req.param('candidateId'), session.novelId],
    )
    if (!image) throw new AiError('invalid', '封面候选已被采纳或移除', 404)
    return new Response(new Uint8Array(image.data), {
      headers: { 'Content-Type': image.content_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  })
  return routes
}
