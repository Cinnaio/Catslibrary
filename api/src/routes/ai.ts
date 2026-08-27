/**
 * /api/ai —— AI 能力入口。
 * 读者侧：GET /status（能力探测）、POST /recap（章节前情提要，先查缓存再计配额）。
 * 管理侧：GET|PUT /settings、POST /test（连通性自检）、GET /usage（用量统计）。
 */
import { Hono, type Context } from 'hono'
import { getDb } from '../db/pool'
import { all, first, run, withTx } from '../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from '../services/ai/client'
import { isImageAiConfigured, imageProvider, imageProviderLabel } from '../services/ai/image'
import { generateCoverPrompt, generateCoverPromptTask, generateNovelCover, newCoverVariationId, normalizeCoverPrompt } from '../services/ai/cover'
import { getAiSettings, saveAiSettings } from '../services/ai/settings'
import { readRuntimeConfig, writeRuntimeConfig, syncRuntimeConfigToEnv, type RuntimeConfigKey } from '../runtime-config'
import { generateRecap, getCachedRecap, loadChapterForRecap } from '../services/ai/summary'
import { generateCatchup, getCachedCatchup, inspectCatchup } from '../services/ai/catchup'
import {
  invalidateChapter,
  listBatchDrafts,
  listGenerationDetails,
  deleteGeneration,
  deleteGenerations,
  restoreGenerations,
  getGeneration,
  updateGenerationResult,
  UNDO_WINDOW_MS,
  type GenerationRow,
  type BatchDraft,
} from '../services/ai/generations'
import { escapeLike } from '../services/text'
import { generateContinuationChapters, generateWriting, generateWritingTitles, parseContinuationTitle, recentNovelContext } from '../services/ai/writing'
import { extractStyleProfile, getStyleProfile } from '../services/ai/style-profile'
import { extractPlotState, getPlotState } from '../services/ai/plot-state'
import { extractRelationshipProfile, getRelationshipProfile } from '../services/ai/relationship-profile'
import { checkQuota, recordUsage, startOfToday, summarizeUsage } from '../services/ai/usage'
import { optionalUser, requireAdmin, requireUser, type AuthEnv } from '../middlewares/auth'
import { cancelAiTask, countActiveWritingTasks, createAiTask, deleteAiTask, getAiTask, listAiTasks, updateAiTask } from '../services/ai/tasks'
import { adoptCoverCandidate, deleteCoverCandidate, listCoverCandidates, storeCover, MAX_COVER_BYTES } from '../services/covers'
import { clientIpFromContext } from '../services/ai/audit-context'

export const aiRoutes = new Hono<AuthEnv>()

async function auditRequestContext(c: Context<AuthEnv>, db: ReturnType<typeof getDb>): Promise<{ ipAddress?: string; userAgent?: string }> {
  const settings = await getAiSettings(db)
  return {
    ipAddress: settings.logIpAddress ? clientIpFromContext(c) : undefined,
    userAgent: settings.logUserAgent ? c.req.header('User-Agent') || '' : undefined,
  }
}

// ---------- 能力探测（匿名可用，前端据此决定是否渲染 AI 入口） ----------

aiRoutes.get('/status', optionalUser(), async (c) => {
  const configured = isTextAiConfigured()
  const settings = await getAiSettings(getDb())
  const user = c.get('user')
  const isAdmin = user?.role === 'admin'

  let quota: { used: number; limit: number; resetAt: number } | null = null
  if (user) {
    const state = await checkQuota(getDb(), user.id, settings.dailyQuota, isAdmin)
    quota = { used: state.used, limit: state.limit, resetAt: state.resetAt }
  }

  return c.json(
    {
      configured,
      // 未登录用户不给 AI 能力：调用要记账到具体用户头上
      features: { recap: configured && settings.recapEnabled && !!user, catchup: configured && settings.catchupEnabled && !!user },
      model: configured ? textProvider().model : '',
      imageConfigured: isImageAiConfigured(),
      quota,
      // 「回来接着读」的过期天数：前端据此决定入口是否渲染，与后端判定同源
      catchupStaleDays: settings.catchupStaleDays,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

// ---------- 章节前情提要 ----------

/** 只查缓存，不触发生成、不计配额：阅读器进章时静默预取。 */
aiRoutes.get('/recap', requireUser(), async (c) => {
  const db = getDb()
  const chapterId = String(c.req.query('chapterId') || '').trim()
  if (!chapterId) return c.json({ error: 'chapterId is required' }, 400)

  const settings = await getAiSettings(db)
  if (!settings.recapEnabled || !isTextAiConfigured()) return c.json({ recap: '', cached: false }, 200, { 'Cache-Control': 'no-store' })

  const cached = await getCachedRecap(db, chapterId, textProvider().model)
  return c.json(cached ? { recap: cached.result, cached: true, model: cached.model, id: cached.id } : { recap: '', cached: false }, 200, {
    'Cache-Control': 'no-store',
  })
})

aiRoutes.post('/recap', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const isAdmin = user.role === 'admin'
  const body = (await c.req.json().catch(() => ({}))) as { chapterId?: unknown; force?: unknown }
  const chapterId = String(body.chapterId || '').trim()
  if (!chapterId) return c.json({ error: 'chapterId is required' }, 400)

  const settings = await getAiSettings(db)
  if (!settings.recapEnabled) return c.json({ error: 'AI 前情提要已关闭', code: 'disabled' }, 403)
  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)

  const force = !!body.force && isAdmin
  const model = textProvider().model

  if (!force) {
    const cached = await getCachedRecap(db, chapterId, model)
    // 命中缓存不计配额、不记账——这是控制成本的关键路径
    if (cached) return c.json({ recap: cached.result, cached: true, model: cached.model, id: cached.id }, 200, { 'Cache-Control': 'no-store' })
  }

  const quota = await checkQuota(db, user.id, settings.dailyQuota, isAdmin)
  if (!quota.ok) {
    return c.json({ error: '今日 AI 生成次数已用完', code: 'quota_exceeded', used: quota.used, limit: quota.limit, resetAt: quota.resetAt }, 429)
  }

  const chapter = await loadChapterForRecap(db, chapterId)
  if (!chapter) return c.json({ error: '章节不存在' }, 404)

  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [chapter.novel_id])

  try {
    if (force) await invalidateChapter(db, 'summary', chapterId)
    const result = await generateRecap(db, {
      chapter,
      novelTitle: novel?.title || '',
      maxChapterChars: settings.maxChapterChars,
      userId: user.id,
      ...(await auditRequestContext(c, db)),
    })
    return c.json({ recap: result.generation.result, cached: false, model: result.generation.model, id: result.generation.id }, 200, {
      'Cache-Control': 'no-store',
    })
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

// ---------- 回来接着读（进度感知的连贯回顾） ----------

aiRoutes.post('/catchup', requireUser(), async (c) => {
  const db = getDb()
  const user = c.get('user')
  const isAdmin = user.role === 'admin'
  const body = (await c.req.json().catch(() => ({}))) as { novelId?: unknown }
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId is required' }, 400)

  const settings = await getAiSettings(db)
  if (!settings.catchupEnabled) return c.json({ error: 'AI 回顾总结已关闭', code: 'disabled' }, 403)
  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)

  const model = textProvider().model
  const inspection = await inspectCatchup(db, user.id, novelId, model)
  if (!inspection.source) {
    return c.json({ recap: null, cached: false, reason: inspection.reason }, 200, { 'Cache-Control': 'no-store' })
  }

  // 命中缓存不计配额、不记账；素材检查与缓存键使用同一份 inspection
  const cached = await getCachedCatchup(db, user.id, novelId, model, inspection)
  if (cached) return c.json({ recap: cached.result, cached: true, model: cached.model, id: cached.id }, 200, { 'Cache-Control': 'no-store' })

  const quota = await checkQuota(db, user.id, settings.dailyQuota, isAdmin)
  if (!quota.ok) {
    return c.json({ error: '今日 AI 生成次数已用完', code: 'quota_exceeded', used: quota.used, limit: quota.limit, resetAt: quota.resetAt }, 429)
  }

  try {
    const result = await generateCatchup(db, { userId: user.id, novelId, source: inspection.source, ...(await auditRequestContext(c, db)) })
    return c.json(
      { recap: result.generation?.result || null, cached: false, model: result.generation?.model, id: result.generation?.id, chapterIds: result.chapterIds },
      200,
      { 'Cache-Control': 'no-store' },
    )
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

// ---------- 管理端 ----------

aiRoutes.get('/settings', requireAdmin(), async (c) => {
  const settings = await getAiSettings(getDb())
  const provider = textProvider()
  const imgProvider = imageProvider()
  const stored = readRuntimeConfig()
  // 供应商密钥可编辑字段：回显运行时层落盘的值（密钥脱敏，只告诉前端是否已设）。
  // 当值来自真实环境变量（未落在运行时文件）时，字段为空但 hasKey=true，前端据此显示「由环境变量设定」。
  return c.json(
    {
      settings,
      provider: { configured: isTextAiConfigured(), host: providerLabel(provider.baseUrl), model: provider.model, hasKey: !!provider.apiKey },
      // 文本供应商可编辑配置：baseUrl/model 回显落盘值供编辑；apiKey 仅回显是否已存，不回传明文
      providerConfig: {
        baseUrl: stored.AI_TEXT_BASE_URL || '',
        model: stored.AI_TEXT_MODEL || '',
        hasApiKey: !!stored.AI_TEXT_API_KEY,
      },
      // 图像供应商：与文本对称，供后台「封面生成」与配置面板使用
      imageProvider: {
        configured: isImageAiConfigured(),
        host: imageProviderLabel(imgProvider.baseUrl),
        model: imgProvider.model,
        hasKey: !!imgProvider.apiKey,
      },
      imageProviderConfig: {
        baseUrl: stored.AI_IMAGE_BASE_URL || '',
        model: stored.AI_IMAGE_MODEL || '',
        hasApiKey: !!stored.AI_IMAGE_API_KEY,
      },
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

aiRoutes.put('/settings', requireAdmin(), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const settings = await saveAiSettings(getDb(), body)
  return c.json({ settings })
})

/** 供应商可编辑键白名单：文本 + 图像两套模型三件套，密钥走运行时层落盘。 */
const PROVIDER_KEYS: RuntimeConfigKey[] = ['AI_TEXT_BASE_URL', 'AI_TEXT_API_KEY', 'AI_TEXT_MODEL', 'AI_IMAGE_BASE_URL', 'AI_IMAGE_API_KEY', 'AI_IMAGE_MODEL']
const PROVIDER_KEY_SET = new Set<string>(PROVIDER_KEYS)

/**
 * 修改 AI 供应商配置（baseUrl / apiKey / model）。
 * body.scope 区分 'text'（默认）与 'image'，决定改动落到文本三件套还是图像三件套；
 * 未传 scope 时按文本处理（兼容历史调用）。
 * - 空字符串表示清空该键；
 * - apiKey 为空字符串时不改动（保留原值），传 ' ' 之类才视为清空——
 *   前端密钥框默认空，避免「打开页面就清空了已存密钥」。
 * 写入 data/runtime-config.json（chmod 0600）并同步到 process.env，
 * 遵循与安装向导相同的优先级：真实环境变量优先，后台改动不覆盖显式设定值。
 */
aiRoutes.put('/provider', requireAdmin(), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    baseUrl?: unknown
    apiKey?: unknown
    model?: unknown
    scope?: unknown
  }
  const scope = body.scope === 'image' ? 'image' : 'text'
  const prefix = scope === 'image' ? 'AI_IMAGE_' : 'AI_TEXT_'
  const patch: Partial<Record<RuntimeConfigKey, string>> = {}
  // 拼出键名后用白名单集合校验，确保 scope 之外的键不会被注入
  const pushKey = (suffix: 'BASE_URL' | 'API_KEY' | 'MODEL', value: string) => {
    const key = `${prefix}${suffix}` as RuntimeConfigKey
    if (PROVIDER_KEY_SET.has(key)) patch[key] = value
  }
  if ('baseUrl' in body) pushKey('BASE_URL', String(body.baseUrl ?? '').trim())
  if ('model' in body) pushKey('MODEL', String(body.model ?? '').trim())
  // apiKey：明确传空字符串才清空；字段缺失（undefined）时不触碰
  if (body.apiKey !== undefined) pushKey('API_KEY', String(body.apiKey ?? '').trim())

  // before 必须在 writeRuntimeConfig 之前快照，否则旧文件值已丢失，无法判定 env 是否「显式设定」
  const before = readRuntimeConfig()
  writeRuntimeConfig(patch)
  syncRuntimeConfigToEnv(before, patch)

  const provider = textProvider()
  const imgProvider = imageProvider()
  const stored = readRuntimeConfig()
  return c.json(
    {
      ok: true,
      provider: { configured: isTextAiConfigured(), host: providerLabel(provider.baseUrl), model: provider.model, hasKey: !!provider.apiKey },
      providerConfig: {
        baseUrl: stored.AI_TEXT_BASE_URL || '',
        model: stored.AI_TEXT_MODEL || '',
        hasApiKey: !!stored.AI_TEXT_API_KEY,
      },
      imageProvider: {
        configured: isImageAiConfigured(),
        host: imageProviderLabel(imgProvider.baseUrl),
        model: imgProvider.model,
        hasKey: !!imgProvider.apiKey,
      },
      imageProviderConfig: {
        baseUrl: stored.AI_IMAGE_BASE_URL || '',
        model: stored.AI_IMAGE_MODEL || '',
        hasApiKey: !!stored.AI_IMAGE_API_KEY,
      },
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

/** 连通性自检：发一条最小请求，确认 baseUrl/key/model 三件套可用。 */
aiRoutes.post('/test', requireAdmin(), async (c) => {
  if (!isTextAiConfigured()) return c.json({ ok: false, error: 'AI 文本服务未配置（AI_TEXT_BASE_URL / AI_TEXT_API_KEY）', code: 'disabled' }, 503)
  const provider = textProvider()
  const startedAt = Date.now()
  try {
    const res = await chat({
      messages: [{ role: 'user', content: '回复两个字：可用' }],
      // 推理模型的思考 token 也吃这个预算，给太小会拿到空 content
      maxTokens: 256,
      temperature: 0,
      timeoutMs: 20_000,
    })
    await recordUsage(getDb(), {
      userId: c.get('user').id,
      model: res.model,
      provider: providerLabel(provider.baseUrl),
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costMillicents: Math.round(res.cost * 100_000),
      // 连通性测试单独打 tag，审计里与读者真实调用区分开
      generationType: 'test',
      ...(await auditRequestContext(c, getDb())),
    })
    return c.json({ ok: true, model: res.model, reply: res.text.slice(0, 100), elapsedMs: Date.now() - startedAt })
  } catch (err) {
    const aiErr = err instanceof AiError ? err : new AiError('upstream', 'AI 请求失败')
    return c.json({ ok: false, error: aiErr.message, code: aiErr.code, elapsedMs: Date.now() - startedAt }, 200)
  }
})

// ---------- 管理端 AI 创作：先生成草稿，发布时才写入正式章节 ----------

function writingOptions(body: Record<string, any>) {
  return {
    targetWords: body.targetWords,
    chapterCount: body.chapterCount,
  }
}

/** 序列化创作请求参数存入任务行：失败/取消后可按原参数重试。 */
function writingTaskParams(body: Record<string, any>): string {
  return JSON.stringify({
    novelId: String(body.novelId || '').trim(),
    title: String(body.title || '').trim(),
    instruction: String(body.instruction || '').trim(),
    ...(String(body.outline || '').trim() ? { outline: String(body.outline).trim() } : {}),
    ...(String(body.context || '').trim() ? { context: String(body.context).trim() } : {}),
    ...(String(body.afterChapterId || '').trim() ? { afterChapterId: String(body.afterChapterId).trim() } : {}),
    ...(Number(body.targetWords) ? { targetWords: Number(body.targetWords) } : {}),
    ...(Number(body.chapterCount) ? { chapterCount: Number(body.chapterCount) } : {}),
    ...(Number(body.maxTokens) ? { maxTokens: Number(body.maxTokens) } : {}),
    ...(Number.isFinite(Number(body.temperature)) && body.temperature !== undefined && body.temperature !== null
      ? { temperature: Number(body.temperature) }
      : {}),
  })
}

/** 序列化封面描述词任务参数：任务完成后无需依赖原始 HTTP 请求即可恢复或重试。 */
function coverPromptTaskParams(args: {
  novelId: string
  renderTitle: boolean
  platform: string
  stylePreset: string
  composition: string
  variationId: string
  clientRequestId?: string
}): string {
  return JSON.stringify({
    novelId: args.novelId,
    renderTitle: args.renderTitle,
    platform: args.platform,
    stylePreset: args.stylePreset,
    composition: args.composition,
    variationId: args.variationId,
    ...(args.clientRequestId ? { clientRequestId: args.clientRequestId } : {}),
  })
}

/** 后台执行单次创作生成，完成/失败时收尾任务状态（generateWriting 收到外部 taskId 时不自标 completed）。 */
function finalizeWritingTask(db: ReturnType<typeof getDb>, taskId: string, job: Promise<unknown>): void {
  void job
    .then(() => updateAiTask(db, taskId, { status: 'completed', current: 1, step: '已完成' }))
    .catch(async (err) => {
      console.error('[ai] 创作后台任务失败', err)
      const message = err instanceof AiError ? err.message : 'AI 生成失败'
      await updateAiTask(db, taskId, { status: 'failed', error: message }).catch(() => {})
    })
}

type StartWritingResult = { ok: true; task: { id: string; batchId: string; total: number } } | { ok: false; status: 400 | 404 | 429; error: string }

/**
 * 启动一个后台创作任务（大纲 / 章节 / 多章续写），立即返回任务信息。
 * 生成最长可达数十分钟，同步 HTTP 连接会被反向代理超时掐断，因此统一走
 * 任务模式：前端轮询 GET /tasks/:id 看进度，产物在「已生成内容」。
 * 原始参数存入任务行，POST /tasks/:id/retry 据此重试。
 */
/** 断点恢复：取原批次已生成的草稿，供 continue 任务重试时跳过已生成章节。 */
async function loadResumeDrafts(db: ReturnType<typeof getDb>, batchId: string): Promise<{ batchId: string; drafts: BatchDraft[] } | undefined> {
  const drafts = await listBatchDrafts(db, batchId)
  return drafts.length ? { batchId, drafts } : undefined
}

async function startWritingJob(
  db: ReturnType<typeof getDb>,
  user: { id: string },
  kind: 'write_outline' | 'write_chapter' | 'continue',
  body: Record<string, any>,
  audit: { ipAddress?: string; userAgent?: string },
  resume?: { batchId: string; drafts: BatchDraft[] },
): Promise<StartWritingResult> {
  const novelId = String(body.novelId || '').trim()
  const title = String(body.title || '').trim()
  const instruction = String(body.instruction || '').trim()

  // 并发上限（软限制，防误操作与上游限流）：运行中的创作任务过多时拒绝新任务
  const settings = await getAiSettings(db)
  const active = await countActiveWritingTasks(db)
  if (active >= settings.maxConcurrentWritingTasks) {
    return { ok: false, status: 429, error: `已有 ${active} 个创作任务在运行（上限 ${settings.maxConcurrentWritingTasks}），请等待完成或取消后再试` }
  }

  if (kind === 'write_outline') {
    if (!title) return { ok: false, status: 400, error: 'title 必填' }
    const task = await createAiTask(db, { userId: user.id, novelId, kind, prompt: instruction || title, params: writingTaskParams(body) })
    finalizeWritingTask(
      db,
      task.id,
      generateWriting(db, {
        userId: user.id,
        novelId,
        kind,
        title,
        instruction,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        ...writingOptions(body),
        taskId: task.id,
        ...audit,
      }),
    )
    return { ok: true, task: { id: task.id, batchId: '', total: 1 } }
  }

  if (!novelId) return { ok: false, status: 400, error: 'novelId 必填' }
  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [novelId])
  if (!novel) return { ok: false, status: 404, error: '小说不存在' }

  if (kind === 'write_chapter') {
    if (!title) return { ok: false, status: 400, error: 'novelId 和 title 必填' }
    const task = await createAiTask(db, { userId: user.id, novelId, kind, prompt: instruction || title, params: writingTaskParams(body) })
    finalizeWritingTask(
      db,
      task.id,
      generateWriting(db, {
        userId: user.id,
        novelId,
        kind,
        title: novel.title,
        instruction,
        outline: String(body.outline || '').trim(),
        context: String(body.context || '').trim(),
        maxTokens: body.maxTokens,
        temperature: body.temperature,
        ...writingOptions(body),
        taskId: task.id,
        ...audit,
      }),
    )
    return { ok: true, task: { id: task.id, batchId: '', total: 1 } }
  }

  // continue：串行多章，任务完结状态由 generateContinuationChapters 自己收尾（completed/cancelled）
  const count = Math.max(1, Math.min(20, Math.trunc(Number(body.chapterCount) || 1)))
  const finalInstruction = String(body.instruction || title || '自然推进剧情，完成一个有悬念的章节段落').trim()
  // 上下文与审计信息在请求内取好：后台执行时请求上下文已不可用
  const context = await recentNovelContext(db, novelId, body.afterChapterId ? String(body.afterChapterId) : undefined)
  const batchId = resume?.batchId || `continue_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const task = await createAiTask(db, {
    userId: user.id,
    novelId,
    kind: 'continue',
    total: count,
    batchId,
    prompt: finalInstruction,
    params: writingTaskParams(body),
  })
  if (resume && resume.drafts.length)
    await updateAiTask(db, task.id, { current: resume.drafts.length, step: `已生成 ${resume.drafts.length} / ${count} 章，断点恢复中` })
  void generateContinuationChapters(db, {
    userId: user.id,
    novelId,
    title: novel.title,
    instruction: finalInstruction,
    context,
    maxTokens: body.maxTokens,
    temperature: body.temperature,
    ...writingOptions(body),
    batchId,
    taskId: task.id,
    startIndex: resume?.drafts.length || 0,
    ...(resume?.drafts.length ? { existingDrafts: resume.drafts } : {}),
    ...audit,
  }).catch(async (err) => {
    console.error('[ai] 续写后台任务失败', err)
    const message = err instanceof AiError ? err.message : 'AI 生成失败'
    await updateAiTask(db, task.id, { status: 'failed', error: message }).catch(() => {})
  })
  return { ok: true, task: { id: task.id, batchId, total: count } }
}

function startWritingRoute(kind: 'write_outline' | 'write_chapter' | 'continue') {
  return async (c: Context<AuthEnv>) => {
    const db = getDb()
    const body = await c.req.json().catch(() => ({}))
    if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)
    const result = await startWritingJob(db, c.get('user'), kind, body, await auditRequestContext(c, db))
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json({ ok: true, taskId: result.task.id, batchId: result.task.batchId, total: result.task.total }, 202)
  }
}

aiRoutes.post('/writing/outline', requireAdmin(), startWritingRoute('write_outline'))
aiRoutes.post('/writing/chapter', requireAdmin(), startWritingRoute('write_chapter'))
aiRoutes.post('/writing/continue', requireAdmin(), startWritingRoute('continue'))

// ---------- 管理端 AI 封面生成：后台任务模式，结果落 novel_covers ----------

/**
 * 为小说生成封面：后台任务（与 writing 对称），立即返回 taskId。
 * 生成结果直接落 novel_covers（覆盖式），公开页经 /api/cover/:id 自动生效；
 * 任务记录在 ai_tasks（kind='cover'），可取消/重试；成本记账在 ai_usage。
 */
aiRoutes.post('/cover/generate', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const novel = await first<{ title: string }>(db, 'SELECT title FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  const settings = await getAiSettings(db)
  let prompt = ''
  try {
    prompt = normalizeCoverPrompt(body.prompt, settings.coverPromptMaxChars)
  } catch (err) {
    return aiErrorResponse(c, err)
  }
  if (!isImageAiConfigured()) return c.json({ error: 'AI 图像服务未配置（AI_IMAGE_BASE_URL / AI_IMAGE_API_KEY）', code: 'disabled' }, 503)
  // 文字层默认取运行时设置（未支持中文渲染的模型建议关）；请求显式传布尔时覆盖
  const renderTitle = typeof body.renderTitle === 'boolean' ? body.renderTitle : settings.coverRenderTitle
  const platform = typeof body.platform === 'string' && body.platform ? body.platform : settings.coverPlatform
  const stylePreset = typeof body.stylePreset === 'string' && body.stylePreset ? body.stylePreset : 'auto'
  const composition = typeof body.composition === 'string' && body.composition ? body.composition : 'auto'
  const variationId = typeof body.variationId === 'string' && body.variationId.trim() ? body.variationId.trim() : newCoverVariationId()

  const task = await createAiTask(db, {
    userId: c.get('user').id,
    novelId,
    kind: 'cover',
    total: 1,
    prompt: prompt || '生成封面',
    params: JSON.stringify({ novelId, prompt, renderTitle, platform, stylePreset, composition, variationId }),
  })
  void generateNovelCover(db, {
    userId: c.get('user').id,
    novelId,
    renderTitle,
    platform,
    stylePreset,
    composition,
    variationId,
    prompt,
    taskId: task.id,
    ...(await auditRequestContext(c, db)),
  })
    .then(() => updateAiTask(db, task.id, { status: 'completed', current: 1, step: '封面已生成，待采纳' }))
    .catch(async (err) => {
      console.error('[ai] 封面生成后台任务失败', err)
      const message = err instanceof AiError ? err.message : '封面生成失败'
      await updateAiTask(db, task.id, { status: 'failed', error: message }).catch(() => {})
    })
  return c.json({ ok: true, taskId: task.id, batchId: '', total: 1 }, 202)
})

aiRoutes.post('/cover/prompt', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const settings = await getAiSettings(db)
  const renderTitle = typeof body.renderTitle === 'boolean' ? body.renderTitle : settings.coverRenderTitle
  const platform = typeof body.platform === 'string' && body.platform ? body.platform : settings.coverPlatform
  const stylePreset = typeof body.stylePreset === 'string' && body.stylePreset ? body.stylePreset : 'auto'
  const composition = typeof body.composition === 'string' && body.composition ? body.composition : 'auto'
  const variationId = typeof body.variationId === 'string' && body.variationId.trim() ? body.variationId.trim() : newCoverVariationId()

  // iOS 端请求后台模式：先落任务，再异步执行，App 被挂起后可凭 taskId 恢复结果。
  if (body.async === true) {
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.trim().slice(0, 120) : ''
    const task = await createAiTask(db, {
      userId: c.get('user').id,
      novelId,
      kind: 'cover_prompt',
      total: 1,
      prompt: '生成封面描述词',
      params: coverPromptTaskParams({ novelId, renderTitle, platform, stylePreset, composition, variationId, clientRequestId }),
    })
    const audit = await auditRequestContext(c, db)
    void generateCoverPromptTask(db, {
      userId: c.get('user').id,
      novelId,
      renderTitle,
      platform,
      stylePreset,
      composition,
      variationId,
      taskId: task.id,
      ...audit,
    })
    return c.json({ ok: true, taskId: task.id, batchId: '', total: 1 }, 202)
  }

  try {
    const result = await generateCoverPrompt(db, novelId, { renderTitle, platform, stylePreset, composition, variationId })
    return c.json({ prompt: result.prompt, metadata: result.metadata })
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

// ---------- AI 封面候选管理：生成结果先落候选，采纳/弃用由管理员决定 ----------

/** 列出一本小说的 AI 封面候选（含 dataUrl，前端 <img> 直接展示；不返回二进制经网络）。 */
aiRoutes.get('/cover/candidates', requireAdmin(), async (c) => {
  const db = getDb()
  const novelId = String(c.req.query('novelId') || '').trim()
  const items = novelId ? await listCoverCandidates(db, novelId) : []
  return c.json({ items, total: items.length }, 200, { 'Cache-Control': 'no-store' })
})

/** 采纳候选：覆盖为当前封面并删除候选，读者端 /api/cover/:id 立即生效。 */
aiRoutes.post('/cover/candidates/:id/adopt', requireAdmin(), async (c) => {
  const db = getDb()
  const id = String(c.req.param('id') || '').trim()
  const ok = await adoptCoverCandidate(db, id)
  if (!ok) return c.json({ error: '候选封面不存在或已被处理' }, 404)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

/** 弃用候选：删除，不触碰当前封面。 */
aiRoutes.delete('/cover/candidates/:id', requireAdmin(), async (c) => {
  const db = getDb()
  const id = String(c.req.param('id') || '').trim()
  const ok = await deleteCoverCandidate(db, id)
  if (!ok) return c.json({ error: '候选封面不存在或已被处理' }, 404)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

/** 上传本地图片替换当前封面：直接覆盖 novel_covers（source='upload'），读者端立即生效。 */
aiRoutes.post('/cover/upload', requireAdmin(), async (c) => {
  const db = getDb()
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('cover')
  const novelId = String(form?.get('novelId') || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  if (!file || typeof (file as File).arrayBuffer !== 'function') return c.json({ error: '请选择图片文件' }, 400)
  const type = String((file as File).type || '')
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) {
    return c.json({ error: '封面必须是 JPG/PNG/WebP/GIF' }, 400)
  }
  const data = Buffer.from(await (file as File).arrayBuffer())
  if (!data.byteLength || data.byteLength > MAX_COVER_BYTES) {
    return c.json({ error: `封面不能超过 ${Math.round(MAX_COVER_BYTES / 1024 / 1024)}MB` }, 400)
  }
  await storeCover(db, novelId, new Uint8Array(data), type, 'upload')
  // 封面变了同步 bump novels.updated_at（前端封面 <img> 用 updatedAt 当 ?v= 破缓存戳）
  await run(db, 'UPDATE novels SET updated_at = $1 WHERE id = $2', [Date.now(), novelId])
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

aiRoutes.post('/writing/titles', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const content = String(body.content || '').trim()
  if (!content) return c.json({ error: 'content 必填' }, 400)
  if (content.length < 20) return c.json({ error: '正文太短，无法生成合适的标题' }, 422)
  try {
    const result = await generateWritingTitles(db, {
      userId: c.get('user').id,
      novelId: String(body.novelId || '').trim(),
      content,
      contextTitle: String(body.contextTitle || '').trim(),
      ...(await auditRequestContext(c, db)),
    })
    return c.json({ titles: result.titles, usage: result.usage })
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

// ---------- 风格画像：从小说已发布章节提取风格特征，续写时拼进 system prompt ----------

/**
 * 提取/刷新某部小说的风格画像。一次性成本（取样最近几章 → 文本模型分析 → 落库），
 * 之后每次续写直接复用，不再烧钱。无章节时写兜底画像，不报错。
 */
aiRoutes.post('/writing/style-profile', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  try {
    const result = await extractStyleProfile(db, {
      userId: c.get('user').id,
      novelId,
      ...(await auditRequestContext(c, db)),
    })
    return c.json({ ok: true, ...result }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

/** 读取某部小说已存的风格画像（管理端展示用，未提取过返回空串）。 */
aiRoutes.get('/writing/style-profile/:novelId', requireAdmin(), async (c) => {
  const db = getDb()
  const novelId = String(c.req.param('novelId') || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const profile = await getStyleProfile(db, novelId)
  return c.json({ profile })
})

// ---------- 情节状态：从小说已发布章节提取结构化角色处境/伏笔/冲突，续写时拼进 user 消息 ----------

/**
 * 提取/刷新某部小说的情节状态。取样最近 N 章（可配，默认 8）→ 文本模型结构化分析 → 落库。
 * 多章续写时防止人设漂移、伏笔遗忘。无章节时写空状态，不报错。
 */
aiRoutes.post('/writing/plot-state', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  try {
    const result = await extractPlotState(db, {
      userId: c.get('user').id,
      novelId,
      ...(Number(body.sampleChapters) ? { sampleChapters: Number(body.sampleChapters) } : {}),
      ...(await auditRequestContext(c, db)),
    })
    return c.json({ ok: true, ...result }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

/**
 * 读取某部小说已存的情节状态（管理端展示用，未提取过返回空串）。
 * 同时回传已发布章节数，前端据此判断状态是否落后于最新章节（过期提醒）。
 */
aiRoutes.get('/writing/plot-state/:novelId', requireAdmin(), async (c) => {
  const db = getDb()
  const novelId = String(c.req.param('novelId') || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const [plotState, novel] = await Promise.all([
    getPlotState(db, novelId),
    first<{ chapter_count: number }>(db, 'SELECT chapter_count FROM novels WHERE id = $1', [novelId]),
  ])
  return c.json({ state: plotState.state, chaptersThrough: plotState.chaptersThrough, chapterCount: Number(novel?.chapter_count) || 0 })
})

// ---------- 关系画像：从小说已发布章节提取角色关系动态/权力结构/心理边界，续写时拼进 system prompt ----------

/**
 * 提取/刷新某部小说的关系画像。取样最近 N 章（可配，默认 10）→ 文本模型结构化分析 → 落库。
 * 防 skill 踩坑：主从写成平等恋人、奖赏手段当真心、从属试探写成主导。无章节时写空画像，不报错。
 */
aiRoutes.post('/writing/relationship-profile', requireAdmin(), async (c) => {
  const db = getDb()
  const body = await c.req.json().catch(() => ({}))
  const novelId = String(body.novelId || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id = $1', [novelId])
  if (!novel) return c.json({ error: '小说不存在' }, 404)
  try {
    const result = await extractRelationshipProfile(db, {
      userId: c.get('user').id,
      novelId,
      ...(Number(body.sampleChapters) ? { sampleChapters: Number(body.sampleChapters) } : {}),
      ...(await auditRequestContext(c, db)),
    })
    return c.json({ ok: true, ...result }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return aiErrorResponse(c, err)
  }
})

/** 读取某部小说已存的关系画像（管理端展示用，未提取过返回空串）。 */
aiRoutes.get('/writing/relationship-profile/:novelId', requireAdmin(), async (c) => {
  const db = getDb()
  const novelId = String(c.req.param('novelId') || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)
  const profile = await getRelationshipProfile(db, novelId)
  return c.json({ profile })
})

aiRoutes.put('/writing/drafts/:id', requireAdmin(), async (c) => {
  const id = String(c.req.param('id') || '')
  const body = await c.req.json().catch(() => ({}))
  const row = await getGeneration(getDb(), id)
  if (!row || row.status !== 'draft' || !['write_chapter', 'continue', 'write_outline'].includes(row.kind))
    return c.json({ error: '草稿不存在或不可编辑' }, 404)
  const result = String(body.result ?? '').trim()
  if (!result) return c.json({ error: '内容不能为空' }, 400)
  await updateGenerationResult(getDb(), id, result)
  return c.json({ ok: true, id, result })
})

/** 事务内的业务性失败：回滚后由路由层转成对应的 4xx。 */
class PublishError extends Error {
  constructor(
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'PublishError'
  }
}

aiRoutes.post('/writing/drafts/:id/publish', requireAdmin(), async (c) => {
  const db = getDb()
  const id = String(c.req.param('id') || '')
  const body = await c.req.json().catch(() => ({}))
  const row = await getGeneration(db, id)
  if (!row || row.status !== 'draft' || !['write_chapter', 'continue'].includes(row.kind)) return c.json({ error: '可发布的章节草稿不存在' }, 404)
  const novelId = String(body.novelId || row.novel_id || '').trim()
  // 兼容修复前落库的草稿：标题可能仍在正文首行，发布时再解析一次并剥离。
  const parsed = parseContinuationTitle(row.result)
  const storedTitle = draftBatchParams(row.params_json).draftTitle
  const title = String(body.title || '').trim() || storedTitle || parsed.title
  const content = parsed.title ? parsed.body : row.result
  if (!novelId || !title || !content.trim()) return c.json({ error: 'novelId、title 和内容必填' }, 400)
  const chapterId = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const now = Date.now()
  try {
    // 插章节、刷计数、改草稿状态放同一事务，任一步失败整体回滚，不留半成品
    const order = await withTx(db, async (q) => {
      // 锁小说行：同一本书的并发发布被串行化，MAX+1 取号不会重复
      const novel = await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [novelId])
      if (!novel.rows.length) throw new PublishError(404, '小说不存在')
      // 带条件更新原子占用草稿：同一草稿并发发布时只有一个请求能成功
      const claimed = await q("UPDATE ai_generations SET status = 'published', chapter_id = $1 WHERE id = $2 AND status = 'draft'", [chapterId, id])
      if (!claimed.rowCount) throw new PublishError(409, '草稿已被发布或不可发布')
      const max = await q<{ max_order: number }>('SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM chapters WHERE novel_id = $1', [novelId])
      const nextOrder = Number(max.rows[0]?.max_order || 0) + 1
      await q('INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
        chapterId,
        novelId,
        title,
        content,
        nextOrder,
        content.replace(/<[^>]*>/g, '').length,
        '',
        now,
      ])
      await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
      return nextOrder
    })
    return c.json({ ok: true, chapter: { id: chapterId, novelId, title, order } })
  } catch (err) {
    if (err instanceof PublishError) return c.json({ error: err.message }, err.httpStatus)
    throw err
  }
})

/** 从 params_json 取批次字段（batchId / batchIndex / 续写解析出的 draftTitle），解析失败按无批次处理。 */
function draftBatchParams(paramsJson: string): { batchId: string; batchIndex: number; draftTitle: string } {
  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>
    return {
      batchId: typeof params.batchId === 'string' ? params.batchId : '',
      batchIndex: Number(params.batchIndex) || 0,
      draftTitle: typeof params.draftTitle === 'string' ? params.draftTitle.trim() : '',
    }
  } catch {
    return { batchId: '', batchIndex: 0, draftTitle: '' }
  }
}

/**
 * 整批发布：把一个续写批次的全部草稿按 batchIndex 顺序发布为正式章节。
 * 标题优先使用各章续写解析出的 AI 标题，缺失时回退「第 N 章」（沿现有章节序号递增）。
 */
aiRoutes.post('/writing/batches/:batchId/publish', requireAdmin(), async (c) => {
  const db = getDb()
  const batchId = String(c.req.param('batchId') || '').trim()
  if (!batchId) return c.json({ error: 'batchId 必填' }, 400)
  const body = await c.req.json().catch(() => ({}))

  // LIKE 先粗筛（batchId 由服务端生成，转义只为防御异常输入），再解析 params_json 精确匹配
  const candidates = await all<GenerationRow>(
    db,
    `SELECT * FROM ai_generations WHERE kind = 'continue' AND status = 'draft' AND deleted_at = 0 AND params_json LIKE $1 ORDER BY created_at ASC`,
    [`%"batchId":"${escapeLike(batchId)}"%`],
  )
  const drafts = candidates
    .map((row) => ({ row, batch: draftBatchParams(row.params_json) }))
    .filter((d) => d.batch.batchId === batchId && d.row.result.trim())
    .sort((a, b) => a.batch.batchIndex - b.batch.batchIndex)
  if (!drafts.length) return c.json({ error: '该批次没有可发布的草稿' }, 404)

  const novelId = String(body.novelId || drafts[0]!.row.novel_id || '').trim()
  if (!novelId) return c.json({ error: 'novelId 必填' }, 400)

  const now = Date.now()
  try {
    const published = await withTx(db, async (q) => {
      const novel = await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [novelId])
      if (!novel.rows.length) throw new PublishError(404, '小说不存在')
      const max = await q<{ max_order: number }>('SELECT COALESCE(MAX(sort_order), 0)::int AS max_order FROM chapters WHERE novel_id = $1', [novelId])
      let order = Number(max.rows[0]?.max_order || 0)
      const results: Array<{ id: string; title: string; order: number; generationId: string }> = []
      for (const { row } of drafts) {
        const chapterId = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
        // 原子占用：并发下已被单独发布的草稿跳过，不打断整批
        const claimed = await q("UPDATE ai_generations SET status = 'published', chapter_id = $1 WHERE id = $2 AND status = 'draft'", [chapterId, row.id])
        if (!claimed.rowCount) continue
        order += 1
        // 兼容修复前的旧草稿：标题可能还在正文首行。
        const parsed = parseContinuationTitle(row.result)
        const title = draftBatchParams(row.params_json).draftTitle || parsed.title || `第 ${order} 章`
        const content = parsed.title ? parsed.body : row.result
        await q('INSERT INTO chapters (id, novel_id, title, content, sort_order, word_count, source_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
          chapterId,
          novelId,
          title,
          content,
          order,
          content.replace(/<[^>]*>/g, '').length,
          '',
          now,
        ])
        results.push({ id: chapterId, title, order, generationId: row.id })
      }
      if (!results.length) throw new PublishError(409, '草稿已被发布或不可发布')
      await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
      return results
    })
    return c.json({ ok: true, published, novelId })
  } catch (err) {
    if (err instanceof PublishError) return c.json({ error: err.message }, err.httpStatus)
    throw err
  }
})

/** 撤销单条发布：10 秒窗口内删除刚创建的章节并把草稿改回 draft，超时后拒绝。 */
aiRoutes.post('/writing/drafts/:id/unpublish', requireAdmin(), async (c) => {
  const db = getDb()
  const id = String(c.req.param('id') || '').trim()
  if (!id) return c.json({ error: 'id 必填' }, 400)
  const row = await getGeneration(db, id)
  if (!row || row.status !== 'published' || !row.chapter_id || !['write_chapter', 'continue'].includes(row.kind)) {
    return c.json({ error: '可撤销的已发布草稿不存在' }, 404)
  }
  const now = Date.now()
  try {
    await withTx(db, async (q) => {
      const chapter = await q<{ created_at: number }>('SELECT created_at FROM chapters WHERE id = $1', [row.chapter_id])
      if (!chapter.rows.length) throw new PublishError(404, '章节不存在或已被删除')
      if (now - Number(chapter.rows[0]?.created_at || 0) > UNDO_WINDOW_MS) throw new PublishError(409, '已超过 10 秒可撤销窗口')
      // 锁小说行：撤销发布的章节删除与并发发布/编辑串行化，避免取号冲突
      await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [row.novel_id])
      await q('DELETE FROM chapters WHERE id = $1', [row.chapter_id])
      await q("UPDATE ai_generations SET status = 'draft', chapter_id = '' WHERE id = $1", [id])
      await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [row.novel_id, now])
    })
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof PublishError) return c.json({ error: err.message }, err.httpStatus)
    throw err
  }
})

/** 撤销整批发布：10 秒窗口内删除本批刚创建的章节并把草稿改回 draft，超时后拒绝。 */
aiRoutes.post('/writing/batches/:batchId/unpublish', requireAdmin(), async (c) => {
  const db = getDb()
  const batchId = String(c.req.param('batchId') || '').trim()
  if (!batchId) return c.json({ error: 'batchId 必填' }, 400)
  const now = Date.now()
  try {
    const restored = await withTx(db, async (q) => {
      const candidates = await q<GenerationRow>(
        `SELECT * FROM ai_generations WHERE kind = 'continue' AND status = 'published' AND deleted_at = 0 AND params_json LIKE $1`,
        [`%\"batchId\":\"${escapeLike(batchId)}\"%`],
      )
      const published = candidates.rows
        .map((row) => ({ row, batch: draftBatchParams(row.params_json) }))
        .filter((d) => d.batch.batchId === batchId && d.row.chapter_id)
      if (!published.length) throw new PublishError(404, '该批次没有可撤销的已发布草稿')
      // 批次可能跨小说（极少见），按小说逐个锁行
      const novelIds = [...new Set(published.map((d) => d.row.novel_id))]
      for (const novelId of novelIds) {
        await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [novelId])
      }
      const undone: string[] = []
      for (const { row } of published) {
        const chapter = await q<{ created_at: number }>('SELECT created_at FROM chapters WHERE id = $1', [row.chapter_id])
        if (!chapter.rows.length) continue
        if (now - Number(chapter.rows[0]?.created_at || 0) > UNDO_WINDOW_MS) throw new PublishError(409, '已超过 10 秒可撤销窗口')
        await q('DELETE FROM chapters WHERE id = $1', [row.chapter_id])
        await q("UPDATE ai_generations SET status = 'draft', chapter_id = '' WHERE id = $1", [row.id])
        undone.push(row.id)
      }
      if (!undone.length) throw new PublishError(404, '该批次没有可撤销的已发布草稿')
      for (const novelId of novelIds) {
        await q('UPDATE novels SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE novel_id = $1), updated_at = $2 WHERE id = $1', [novelId, now])
      }
      return undone
    })
    return c.json({ ok: true, restored: restored.length })
  } catch (err) {
    if (err instanceof PublishError) return c.json({ error: err.message }, err.httpStatus)
    throw err
  }
})

aiRoutes.get('/usage', requireAdmin(), async (c) => {
  const db = getDb()
  const today = startOfToday()
  const [todayUsage, last30d] = await Promise.all([summarizeUsage(db, today), summarizeUsage(db, today - 29 * 86_400_000)])
  return c.json({ today: todayUsage, last30d }, 200, { 'Cache-Control': 'no-store' })
})

const TASK_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled'])
const RETRIABLE_TASK_KINDS = new Set(['continue', 'write_outline', 'write_chapter', 'cover', 'cover_prompt'])

aiRoutes.get('/tasks', requireAdmin(), async (c) => {
  const limit = Number.parseInt(c.req.query('limit') || '50', 10) || 50
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0
  const status = TASK_STATUSES.has(c.req.query('status') || '') ? c.req.query('status') : undefined
  const kind = RETRIABLE_TASK_KINDS.has(c.req.query('kind') || '') ? c.req.query('kind') : undefined
  const result = await listAiTasks(getDb(), { limit, offset, status, kind })
  return c.json({ ...result, limit, offset }, 200, { 'Cache-Control': 'no-store' })
})

/**
 * 订阅单个任务的实时快照：封面描述词任务在前台可通过 SSE 接收增量结果。
 * 任务本身仍以 ai_tasks 为事实来源，客户端断线后可以重新订阅或继续轮询。
 */
aiRoutes.get('/tasks/:id/stream', requireAdmin(), async (c) => {
  const id = String(c.req.param('id') || '').trim()
  const initial = await getAiTask(getDb(), id)
  if (!initial) return c.json({ error: '任务不存在' }, 404)

  const db = getDb()
  const signal = c.req.raw.signal
  const encoder = new TextEncoder()
  let cancelFollow: (() => void) | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let lastSignature = ''
      let lastHeartbeatAt = Date.now()

      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }
      const emit = (payload: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          close()
        }
      }

      const follow = async () => {
        try {
          while (!closed && !signal.aborted) {
            const task = await getAiTask(db, id)
            if (!task) break

            const signature = JSON.stringify([task.updatedAt, task.status, task.current, task.step, task.prompt, task.result, task.error])
            if (signature !== lastSignature) {
              lastSignature = signature
              const terminal = ['completed', 'failed', 'cancelled'].includes(task.status)
              emit({ type: terminal ? 'done' : 'update', task })
            }

            if (['completed', 'failed', 'cancelled'].includes(task.status)) break

            const now = Date.now()
            if (now - lastHeartbeatAt >= 10_000) {
              if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'))
              lastHeartbeatAt = now
            }
            await delay(250)
          }
        } catch {
          // 客户端会把连接断开视为可恢复事件，并回退到任务查询。
        } finally {
          close()
        }
      }

      const onAbort = () => close()
      cancelFollow = close
      signal.addEventListener('abort', onAbort, { once: true })
      void follow()
    },
    cancel() {
      cancelFollow?.()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

/** 单任务查询：后台续写等长任务由前端轮询此接口看进度。 */
aiRoutes.get('/tasks/:id', requireAdmin(), async (c) => {
  const task = await getAiTask(getDb(), String(c.req.param('id') || '').trim())
  if (!task) return c.json({ error: '任务不存在' }, 404)
  return c.json({ task }, 200, { 'Cache-Control': 'no-store' })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

aiRoutes.post('/tasks/:id/cancel', requireAdmin(), async (c) => {
  const ok = await cancelAiTask(getDb(), String(c.req.param('id') || '').trim())
  if (!ok) return c.json({ error: '任务不存在或已经结束' }, 404)
  return c.json({ ok: true })
})

/**
 * 删除已结束的任务记录（completed/failed/cancelled）。
 * 运行中的任务须先取消；这是操作性记录，删除不影响 ai_usage 审计账本。
 */
aiRoutes.delete('/tasks/:id', requireAdmin(), async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return c.json({ error: 'id is required' }, 400)
  const ok = await deleteAiTask(getDb(), id)
  if (!ok) return c.json({ error: '任务不存在或仍在运行中，请先取消' }, 404)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

/** 按原参数重试失败/取消的创作任务：新建任务执行，原任务保留作为记录。 */
aiRoutes.post('/tasks/:id/retry', requireAdmin(), async (c) => {
  const db = getDb()
  const source = await getAiTask(db, String(c.req.param('id') || '').trim())
  if (!source) return c.json({ error: '任务不存在' }, 404)
  if (source.status !== 'failed' && source.status !== 'cancelled') return c.json({ error: '只有失败或已取消的任务可以重试' }, 409)
  if (!RETRIABLE_TASK_KINDS.has(source.kind)) return c.json({ error: '该任务类型不支持重试' }, 422)

  let body: Record<string, any> | null = null
  try {
    body = source.params ? (JSON.parse(source.params) as Record<string, any>) : null
  } catch {
    body = null
  }
  if (!body) return c.json({ error: '任务未记录原始参数（旧版本创建），无法重试' }, 422)

  // 封面任务重试：按原参数（novelId）走独立的封面生成路径
  if (source.kind === 'cover') {
    const novelId = String(body.novelId || '').trim()
    if (!novelId) return c.json({ error: '任务未记录 novelId，无法重试' }, 422)
    const settings = await getAiSettings(db)
    let prompt = ''
    try {
      prompt = normalizeCoverPrompt(body.prompt, settings.coverPromptMaxChars)
    } catch (err) {
      return aiErrorResponse(c, err)
    }
    if (!isImageAiConfigured()) return c.json({ error: 'AI 图像服务未配置', code: 'disabled' }, 503)
    const renderTitle = typeof body.renderTitle === 'boolean' ? body.renderTitle : settings.coverRenderTitle
    const platform = typeof body.platform === 'string' && body.platform ? body.platform : settings.coverPlatform
    const stylePreset = typeof body.stylePreset === 'string' && body.stylePreset ? body.stylePreset : 'auto'
    const composition = typeof body.composition === 'string' && body.composition ? body.composition : 'auto'
    const variationId = typeof body.variationId === 'string' && body.variationId.trim() ? body.variationId.trim() : newCoverVariationId()
    const task = await createAiTask(db, {
      userId: c.get('user').id,
      novelId,
      kind: 'cover',
      total: 1,
      prompt: prompt || '生成封面',
      params: JSON.stringify({ novelId, prompt, renderTitle, platform, stylePreset, composition, variationId }),
    })
    const audit = await auditRequestContext(c, db)
    void generateNovelCover(db, {
      userId: c.get('user').id,
      novelId,
      renderTitle,
      platform,
      stylePreset,
      composition,
      variationId,
      prompt,
      taskId: task.id,
      ...audit,
    })
      .then(() => updateAiTask(db, task.id, { status: 'completed', current: 1, step: '封面已生成，待采纳' }))
      .catch(async (err) => {
        console.error('[ai] 封面重试任务失败', err)
        const message = err instanceof AiError ? err.message : '封面生成失败'
        await updateAiTask(db, task.id, { status: 'failed', error: message }).catch(() => {})
      })
    return c.json({ ok: true, taskId: task.id, batchId: '', total: 1 }, 202)
  }

  if (source.kind === 'cover_prompt') {
    const novelId = String(body.novelId || '').trim()
    if (!novelId) return c.json({ error: '任务未记录 novelId，无法重试' }, 422)
    const renderTitle = typeof body.renderTitle === 'boolean' ? body.renderTitle : true
    const platform = typeof body.platform === 'string' && body.platform ? body.platform : 'default'
    const stylePreset = typeof body.stylePreset === 'string' && body.stylePreset ? body.stylePreset : 'auto'
    const composition = typeof body.composition === 'string' && body.composition ? body.composition : 'auto'
    const variationId = typeof body.variationId === 'string' && body.variationId.trim() ? body.variationId.trim() : newCoverVariationId()
    const task = await createAiTask(db, {
      userId: c.get('user').id,
      novelId,
      kind: 'cover_prompt',
      total: 1,
      prompt: '生成封面描述词',
      params: coverPromptTaskParams({ novelId, renderTitle, platform, stylePreset, composition, variationId, clientRequestId: newCoverVariationId() }),
    })
    const audit = await auditRequestContext(c, db)
    void generateCoverPromptTask(db, {
      userId: c.get('user').id,
      novelId,
      renderTitle,
      platform,
      stylePreset,
      composition,
      variationId,
      taskId: task.id,
      ...audit,
    })
    return c.json({ ok: true, taskId: task.id, batchId: '', total: 1 }, 202)
  }

  if (!isTextAiConfigured()) return c.json({ error: 'AI 文本服务未配置', code: 'disabled' }, 503)

  // 断点恢复：continue 任务重试时，先取原批次已生成的草稿，从已完成处接续，避免全量重来
  const resume = source.kind === 'continue' && source.batchId ? await loadResumeDrafts(db, source.batchId) : undefined
  const result = await startWritingJob(
    db,
    c.get('user'),
    source.kind as 'write_outline' | 'write_chapter' | 'continue',
    body,
    await auditRequestContext(c, db),
    resume,
  )
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ ok: true, taskId: result.task.id, batchId: result.task.batchId, total: result.task.total }, 202)
})

// ---------- 审计接口 ----------

/** 用户级 AI 用量审计：按用户聚合统计 */
aiRoutes.get('/audit/users', requireAdmin(), async (c) => {
  const db = getDb()
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10) || 50, 200)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT
      u.id, u.username, u.display_name,
      COUNT(g.id)::int AS call_count,
      SUM(g.prompt_tokens)::int AS total_prompt_tokens,
      SUM(g.completion_tokens)::int AS total_completion_tokens,
      SUM(g.cost_millicents)::int AS total_cost_millicents,
      MAX(g.created_at) AS last_call_at
    FROM users u
    INNER JOIN ai_usage g ON g.user_id = u.id
    GROUP BY u.id, u.username, u.display_name
    HAVING COUNT(g.id) > 0
    ORDER BY total_cost_millicents DESC
    LIMIT $1 OFFSET $2`,
    [limit, offset],
  )

  const totalRow = await first<{ total: number }>(db, 'SELECT COUNT(DISTINCT user_id)::int AS total FROM ai_usage')

  return c.json(
    {
      users: rows.map((r) => ({
        id: String(r.id),
        username: String(r.username || ''),
        displayName: String(r.display_name || ''),
        callCount: Number(r.call_count) || 0,
        totalPromptTokens: Number(r.total_prompt_tokens) || 0,
        totalCompletionTokens: Number(r.total_completion_tokens) || 0,
        totalCostMillicents: Number(r.total_cost_millicents) || 0,
        lastCallAt: Number(r.last_call_at) || 0,
      })),
      total: totalRow?.total || 0,
      limit,
      offset,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

/** 详细调用记录：支持用户、类型、时间筛选 */
aiRoutes.get('/audit/calls', requireAdmin(), async (c) => {
  const db = getDb()
  const userId = c.req.query('userId')
  const type = c.req.query('type')
  const from = Number.parseInt(c.req.query('from') || '0', 10) || 0
  const to = Number.parseInt(c.req.query('to') || String(Date.now()), 10) || Date.now()
  const requestedLimit = Number.parseInt(c.req.query('limit') || '50', 10)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 10), 100)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0

  const conditions = ['u.created_at >= $1', 'u.created_at <= $2']
  const params: unknown[] = [from, to]

  if (userId) {
    params.push(userId)
    conditions.push(`u.user_id = $${params.length}`)
  }

  if (type) {
    params.push(type)
    conditions.push(`u.generation_type = $${params.length}`)
  }

  const where = conditions.join(' AND ')

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT
      u.id, u.generation_type, u.model, u.prompt_tokens, u.completion_tokens, u.image_count, u.ip_address, u.user_agent,
      u.cost_millicents, u.created_at, u.user_id, u.novel_id, u.chapter_id,
      usr.username, usr.display_name,
      n.title AS novel_title,
      c.title AS chapter_title
    FROM ai_usage u
    LEFT JOIN users usr ON usr.id = u.user_id
    LEFT JOIN novels n ON n.id = u.novel_id
    LEFT JOIN chapters c ON c.id = u.chapter_id
    WHERE ${where}
    ORDER BY u.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )

  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM ai_usage u WHERE ${where}`, params)

  return c.json(
    {
      calls: rows.map((r) => ({
        id: String(r.id),
        type: String(r.generation_type || ''),
        model: String(r.model || ''),
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        imageCount: Number(r.image_count) || 0,
        costMillicents: Number(r.cost_millicents) || 0,
        createdAt: Number(r.created_at) || 0,
        userId: String(r.user_id || ''),
        username: String(r.username || ''),
        displayName: String(r.display_name || ''),
        novelId: String(r.novel_id || ''),
        novelTitle: String(r.novel_title || ''),
        chapterId: String(r.chapter_id || ''),
        chapterTitle: String(r.chapter_title || ''),
        ipAddress: String(r.ip_address || ''),
        userAgent: String(r.user_agent || ''),
      })),
      total: totalRow?.total || 0,
      limit,
      offset,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

/** 成本趋势：按天聚合，用于图表展示 */
aiRoutes.get('/audit/trend', requireAdmin(), async (c) => {
  const db = getDb()
  const days = Math.min(Number.parseInt(c.req.query('days') || '30', 10) || 30, 365)
  const from = Date.now() - days * 86_400_000

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT
      TO_CHAR(TO_TIMESTAMP(created_at / 1000), 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS calls,
      SUM(prompt_tokens)::int AS prompt_tokens,
      SUM(completion_tokens)::int AS completion_tokens,
      SUM(cost_millicents)::int AS cost_millicents
    FROM ai_usage
    WHERE created_at >= $1
    GROUP BY date
    ORDER BY date ASC`,
    [from],
  )

  return c.json(
    {
      trend: rows.map((r) => ({
        date: String(r.date),
        calls: Number(r.calls) || 0,
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        costMillicents: Number(r.cost_millicents) || 0,
      })),
      days,
    },
    200,
    { 'Cache-Control': 'no-store' },
  )
})

// ---------- 已生成内容管理 ----------

/** 已生成内容列表：默认只看已发布（读者可见）的，支持按类型/状态筛选。 */
aiRoutes.get('/generations', requireAdmin(), async (c) => {
  const db = getDb()
  const allowedKinds = new Set(['summary', 'catchup', 'continue', 'write_outline', 'write_chapter'])
  const kind = allowedKinds.has(c.req.query('kind') || '') ? c.req.query('kind') : undefined
  // 统一的“已生成内容”默认仍保持读者范围；需要查看全部内容时显式传 all。
  const scope = c.req.query('scope')
  const scopedKinds = scope === 'writing' ? ['continue', 'write_outline', 'write_chapter'] : scope === 'reader' ? ['summary', 'catchup'] : undefined
  const requestedStatus = c.req.query('status')
  const status =
    requestedStatus === 'all'
      ? undefined
      : requestedStatus === 'published' || requestedStatus === 'draft' || requestedStatus === 'rejected'
        ? requestedStatus
        : 'published'
  const requestedLimit = Number.parseInt(c.req.query('limit') || '50', 10)
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 10), 100)
  const offset = Number.parseInt(c.req.query('offset') || '0', 10) || 0

  const { items, total } = await listGenerationDetails(db, { kind, kinds: scopedKinds, status, limit, offset })
  return c.json({ items, total, limit, offset }, 200, { 'Cache-Control': 'no-store' })
})

/** 删除单条已生成内容：软删除（10 秒内可撤销），读者再访问该章/该回顾时会重新生成（计配额）。 */
aiRoutes.delete('/generations/:id', requireAdmin(), async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return c.json({ error: 'id is required' }, 400)

  const removed = await deleteGeneration(getDb(), id)
  if (!removed) return c.json({ error: '内容不存在或已删除' }, 404)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

aiRoutes.post('/generations/batch-delete', requireAdmin(), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : []
  if (!ids.length) return c.json({ error: '请选择要删除的内容' }, 400)
  const deleted = await deleteGenerations(getDb(), ids)
  return c.json({ ok: true, deleted }, 200, { 'Cache-Control': 'no-store' })
})

/** 撤销软删除：仅 10 秒窗口内的记录可恢复（配合批量删除的「撤销」toast）。 */
aiRoutes.post('/generations/restore', requireAdmin(), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : []
  if (!ids.length) return c.json({ error: '请选择要恢复的内容' }, 400)
  const restored = await restoreGenerations(getDb(), ids)
  return c.json({ ok: true, restored }, 200, { 'Cache-Control': 'no-store' })
})

/** AiError → HTTP：客户端只拿到 code 与可展示文案，上游细节留在服务端日志。 */
function aiErrorResponse(c: Context, err: unknown) {
  if (err instanceof AiError) {
    const status = err.code === 'disabled' ? 503 : err.code === 'invalid' ? 422 : err.code === 'timeout' ? 504 : 502
    return c.json({ error: err.message, code: err.code }, status)
  }
  console.error('[ai]', err)
  return c.json({ error: 'AI 服务异常', code: 'upstream' }, 502)
}
