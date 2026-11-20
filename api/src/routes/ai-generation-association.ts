import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getDb } from '../db/pool'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { confirmGenerationAssociation, parseAssociationRequest, previewGenerationAssociation } from '../services/ai/generation-association'
import { idempotencyKeyFromRequest, withIdempotency } from '../services/idempotency'

export const generationAssociationRoutes = new Hono<AuthEnv>()
generationAssociationRoutes.use('*', requireAdmin())
generationAssociationRoutes.post('/preview', async c => {
  try {
    const input = parseAssociationRequest(await c.req.json().catch(() => ({})))
    return c.json(await previewGenerationAssociation(getDb(), input), 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    throw error
  }
})
generationAssociationRoutes.post('/confirm', async c => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const input = parseAssociationRequest(body)
    const revision = typeof body.revision === 'string' ? body.revision : ''
    const operationId = idempotencyKeyFromRequest(c, body)
    if (!operationId || !revision) return c.json({ error: '请先预览关联范围后确认' }, 400)
    return withIdempotency(getDb(), {
      scope: `ai.generations.association.${c.get('user').id}`, operationKey: operationId,
      payload: { ...input, revision },
      audit: { actorUserId: c.get('user').id, action: 'ai.generations.reassociate', targetCount: input.ids.length },
    }, async () => {
      try {
        return c.json(await confirmGenerationAssociation(getDb(), input, revision, c.get('user').id, operationId))
      } catch (error) {
        if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
        throw error
      }
    })
  } catch (error) {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    throw error
  }
})
