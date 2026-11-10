import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getDb } from '../db/pool'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { AiError, isTextAiConfigured } from '../services/ai/client'
import { withProviderSnapshot } from '../services/ai/provider-snapshot'
import { clientIpFromContext } from '../services/ai/audit-context'
import { createAnalysis, editAnalysis, listAnalyses, readAnalysis, requireAnalysis, resumeAnalysis, stopAnalysis } from '../services/ai/novel-analysis-store'
import { runNovelAnalysis } from '../services/ai/novel-analysis'
import { applyAnalysisFinding, createAnalysisReview, previewAnalysisReview, runAnalysisReview, stopAnalysisReview } from '../services/ai/novel-analysis-review'

export const novelAnalysisRoutes = new Hono<AuthEnv>()
novelAnalysisRoutes.use('*', requireAdmin())
novelAnalysisRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  return withProviderSnapshot(next)
})
novelAnalysisRoutes.onError((error, c) => {
  if (error instanceof AiError) return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode)
  console.error('[novel-analysis]', error)
  return c.json({ error: '小说分析暂时不可用，请稍后重试' }, 500)
})
novelAnalysisRoutes.get('/:novelId', async c => {
  const offset = Number(c.req.query('offset') || 0)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new AiError('invalid', '分页参数无效', 422)
  return c.json(await listAnalyses(getDb(), c.req.param('novelId'), offset))
})
novelAnalysisRoutes.post('/:novelId', async c => {
  if (!isTextAiConfigured()) throw new AiError('disabled', '请先配置 AI 文本服务', 503)
  const body = await c.req.json().catch(() => ({}))
  const novelId = c.req.param('novelId')
  const receipt = await createAnalysis(getDb(), c.get('user').id, novelId, body?.request, String(body?.requestId || ''))
  if (receipt.created) void runNovelAnalysis(getDb(), novelId, receipt.reportId, receipt.taskId,
    { ipAddress: clientIpFromContext(c), userAgent: c.req.header('user-agent') }).catch(error => console.error('[novel-analysis-worker]', error))
  return c.json(receipt, receipt.created ? 201 : 200)
})
novelAnalysisRoutes.get('/:novelId/:id', async c => c.json(await readAnalysis(getDb(), c.req.param('novelId'), c.req.param('id'))))
novelAnalysisRoutes.get('/:novelId/:id/review-preview', async c => {
  const starts = c.req.query('paragraphStarts')
  if (starts !== undefined && !/^\d+(?:,\d+)*$/.test(starts)) throw new AiError('invalid', '请选择有效报告段落', 422)
  return c.json(await previewAnalysisReview(getDb(), c.req.param('novelId'), c.req.param('id'), starts === undefined ? undefined : starts.split(',').map(Number)))
})
novelAnalysisRoutes.post('/:novelId/:id/reviews', async c => {
  if (!isTextAiConfigured()) throw new AiError('disabled', '请先配置 AI 文本服务', 503)
  const body = await c.req.json().catch(() => ({}))
  const novelId = c.req.param('novelId'), reportId = c.req.param('id')
  const receipt = await createAnalysisReview(getDb(), c.get('user').id, novelId, reportId, body?.requestId, body?.revision, body?.paragraphStarts)
  if (receipt.created) void runAnalysisReview(getDb(), novelId, reportId, receipt.reviewId, receipt.taskId,
    { ipAddress: clientIpFromContext(c), userAgent: c.req.header('user-agent') }).catch(error => console.error('[analysis-review-worker]', error))
  return c.json(receipt, receipt.created ? 201 : 200)
})
novelAnalysisRoutes.post('/:novelId/:id/reviews/:reviewId/stop', async c => {
  await stopAnalysisReview(getDb(), c.req.param('novelId'), c.req.param('id'), c.req.param('reviewId'))
  return c.json({ ok: true })
})
novelAnalysisRoutes.post('/:novelId/:id/reviews/:reviewId/apply', async c => {
  const body = await c.req.json().catch(() => ({}))
  return c.json(await applyAnalysisFinding(getDb(), c.req.param('novelId'), c.req.param('id'), c.req.param('reviewId'), body?.findingId, body?.revision))
})
novelAnalysisRoutes.get('/:novelId/:id/sources/:sourceId', async c => {
  const report = await requireAnalysis(getDb(), c.req.param('novelId'), c.req.param('id'))
  const source = report.source_json.find(item => item.id === c.req.param('sourceId'))
  if (!source) throw new AiError('invalid', '来源不在本报告中', 404)
  return c.json(source)
})
novelAnalysisRoutes.patch('/:novelId/:id', async c => {
  const body = await c.req.json().catch(() => ({}))
  await editAnalysis(getDb(), c.req.param('novelId'), c.req.param('id'), body?.content, body?.revision)
  return c.json({ ok: true })
})
novelAnalysisRoutes.post('/:novelId/:id/stop', async c => {
  await stopAnalysis(getDb(), c.req.param('novelId'), c.req.param('id'))
  return c.json({ ok: true })
})
novelAnalysisRoutes.post('/:novelId/:id/resume', async c => {
  if (!isTextAiConfigured()) throw new AiError('disabled', '请先配置 AI 文本服务', 503)
  const novelId = c.req.param('novelId')
  const receipt = await resumeAnalysis(getDb(), c.get('user').id, novelId, c.req.param('id'))
  if (receipt.created) void runNovelAnalysis(getDb(), novelId, receipt.reportId, receipt.taskId,
    { ipAddress: clientIpFromContext(c), userAgent: c.req.header('user-agent') }).catch(error => console.error('[novel-analysis-worker]', error))
  return c.json(receipt)
})
