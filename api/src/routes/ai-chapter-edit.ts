import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getDb } from '../db/pool'
import { withTx } from '../db/query'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { AiError, isTextAiConfigured } from '../services/ai/client'
import { clientIpFromContext } from '../services/ai/audit-context'
import { withProviderSnapshot } from '../services/ai/provider-snapshot'
import { getProviderPreset } from '../services/ai/provider-presets'
import { getAiSettings } from '../services/ai/settings'
import { countActiveWritingTasks, createAiTask, updateAiTask } from '../services/ai/tasks'
import { getAgentSession, appendAgentEvent, requireAgentArtifact, trackAgentArtifact } from '../services/ai/agent-store'
import { resolveAgentWritingContext } from '../services/ai/agent-writing'
import { buildChapterEditParams, parseChapterEdit, scopedEditableChapter } from '../services/ai/chapter-edit'
import { runRewriteTask } from '../services/ai/rewrite'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const chapterEditRoutes = new Hono<AuthEnv>()
chapterEditRoutes.use('*', requireAdmin())
chapterEditRoutes.onError((error, c) => {
  if (error instanceof AiError) return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode)
  console.error('[chapter-edit]', error)
  return c.json({ error: '章节改写暂时不可用，请稍后重试' }, 500)
})
chapterEditRoutes.post('/', async c => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const userId = c.get('user').id
  const session = await getAgentSession(db, userId, String(body.sessionId || ''))
  const operationKey = idempotencyKeyFromRequest(c, body, ['clientRequestId'])
  if (!operationKey) throw new AiError('invalid', 'clientRequestId 必填', 422)
  const presetId = String(body.providerPresetId || '')
  const preset = presetId ? getProviderPreset(presetId) : undefined
  if (preset && preset.scope !== 'text') throw new AiError('invalid', '请选择文本模型预设', 422)
  return withProviderSnapshot(() => withIdempotency(db, {
    scope: 'ai.chapter-edit.' + userId + '.' + session.id, operationKey, payload: body,
    audit: { actorUserId: userId, action: 'ai.chapter-edit.generate', targetCount: 1 },
  }, async () => {
    const chapter = await scopedEditableChapter(db, session, String(body.chapterId || ''))
    const params = buildChapterEditParams(session, chapter, body)
    let previousContext
    if (body.previousTaskId) {
      const previous = await requireAgentArtifact(db, session.id, String(body.previousTaskId))
      const edit = parseChapterEdit(previous.params || '{}', previous.result)
      if (previous.kind !== 'chapter_edit' || previous.status !== 'completed' || !edit || previous.novelId !== session.novelId ||
        edit.params.chapterId !== chapter.id || edit.params.baseRevision !== params.baseRevision ||
        edit.params.startUTF16 !== params.startUTF16 || edit.params.endUTF16 !== params.endUTF16)
        throw new AiError('conflict', '上次建议与当前章节或选段不匹配', 409)
      params.previousSuggestion = edit.suggestion
      params.previousTaskId = previous.id
      previousContext = edit.params.agentContext
    }
    const rawWriting = body.agentWriting && typeof body.agentWriting === 'object' && !Array.isArray(body.agentWriting)
      ? body.agentWriting as Record<string, unknown> : {}
    params.agentContext = await resolveAgentWritingContext(db, {
      userId, novelId: session.novelId, afterChapterId: session.afterChapterId, rewrite: true,
      wholeDraft: params.startUTF16 === 0 && params.endUTF16 === chapter.content.length,
    }, { ...rawWriting, sessionId: session.id }, previousContext)
    if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
    if ((await countActiveWritingTasks(db)) >= (await getAiSettings(db)).maxConcurrentWritingTasks)
      throw new AiError('invalid', '已有过多创作任务在运行，请稍后重试', 429)
    const task = await withTx(db, async query => {
      // Deleting the conversation cannot orphan a newly generated suggestion.
      await query('SELECT id FROM ai_agent_sessions WHERE id=$1 FOR UPDATE', [session.id])
      const task = await createAiTask({ query }, { userId, novelId: session.novelId, kind: 'chapter_edit', total: 1,
        prompt: '改写原章节「' + chapter.title + '」', params: JSON.stringify(params) })
      await trackAgentArtifact({ query }, session.id, task.id)
      if (!rawWriting.authorTaskId) await appendAgentEvent({ query }, session.id, 'user', '请为原章节「' + chapter.title + '」生成改写建议。\n' + params.instruction, task.id)
      await appendAgentEvent({ query }, session.id, 'activity', '正在生成「' + chapter.title + '」的章节改写建议：' + params.instruction, '', { artifactTaskId: task.id })
      return task
    })
    void runRewriteTask(db, { taskId: task.id, userId, params, generationType: 'chapter_edit',
      ipAddress: clientIpFromContext(c), userAgent: c.req.header('User-Agent') }).catch(async error => {
      console.error('[chapter-edit] generation failed', error)
      await updateAiTask(db, task.id, { status: 'failed', error: error instanceof AiError ? error.message : '章节建议生成失败' }).catch(() => {})
    })
    return c.json({ ok: true, taskId: task.id, total: 1 }, 202)
  }), preset ? { text: { baseUrl: preset.baseUrl, apiKey: preset.apiKey, model: preset.model } } : undefined)
})
