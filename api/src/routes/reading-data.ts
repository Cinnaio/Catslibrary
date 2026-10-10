import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { normalizeLegacyReadingData, type ReadingDataResult } from '@shared/reading-data'
import { requireUser, type AuthEnv } from '../middlewares/auth'
import { getDb } from '../db/pool'
import { contentPolicyHeaders, resolveContentAccess } from '../services/content-access'
import { applyReadingData, previewReadingData } from '../services/reading-data'

export const readingDataRoutes = new Hono<AuthEnv>()
readingDataRoutes.use('*', requireUser(), bodyLimit({ maxSize: 512 * 1024 }))
readingDataRoutes.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  console.error('[reading-data]', error)
  return c.json({ error: '阅读数据操作失败，请稍后重试' }, 500)
})
async function allowed(c: Parameters<typeof resolveContentAccess>[0]) {
  return (await resolveContentAccess(c)).canViewRestricted && c.req.query('contentMode') !== 'safe'
}
readingDataRoutes.get('/check', async (c) => c.json(await previewReadingData(getDb(), c.get('user').id, await allowed(c)), 200, contentPolicyHeaders()))
readingDataRoutes.get('/operations', async (c) => {
  const rows = await getDb().query<{ result: string }>(
    'SELECT result FROM reading_data_operations WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10',
    [c.get('user').id],
  )
  return c.json(
    {
      operations: rows.rows.map((row) => {
        const result = JSON.parse(row.result) as ReadingDataResult
        return { ...result, clearedNovelIds: [] }
      }),
    },
    200,
    contentPolicyHeaders(),
  )
})
readingDataRoutes.post('/restore/preview', async (c) => {
  const body = await c.req.json().catch(() => null)
  const data = normalizeLegacyReadingData(body?.data)
  if (!data) return c.json({ error: '旧数据格式无效，每类最多支持 500 条' }, 400)
  return c.json(await previewReadingData(getDb(), c.get('user').id, await allowed(c), data), 200, contentPolicyHeaders())
})
for (const kind of ['repair', 'restore'] as const) {
  readingDataRoutes.post(`/${kind}`, async (c) => {
    const body = await c.req.json().catch(() => null)
    const userId = c.get('user').id
    if (
      !body ||
      body.confirmedUserId !== userId ||
      typeof body.operationId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(body.operationId) ||
      typeof body.previewToken !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.previewToken) ||
      !Number.isSafeInteger(body.expiresAt)
    )
      return c.json({ error: '请预览并确认当前账号后再操作' }, 400)
    const data = kind === 'restore' ? normalizeLegacyReadingData(body.data) : undefined
    if (data === null) return c.json({ error: '旧数据格式无效' }, 400)
    return c.json(
      await applyReadingData(getDb(), userId, await allowed(c), {
        operationId: body.operationId,
        previewToken: body.previewToken,
        expiresAt: body.expiresAt,
        ...(data ? { data } : {}),
      }),
      200,
      contentPolicyHeaders(),
    )
  })
}
