import { Hono } from 'hono'
import { getDb } from '../db/pool'
import { requireAdmin, type AuthEnv } from '../middlewares/auth'
import { LanzouError } from '../services/lanzou'
import {
  checkSupplementarySource,
  saveSupplementaryBinding,
  saveSupplementarySource,
  sourceFiles,
  supplementaryOverview,
} from '../services/supplementary-source'

export const supplementarySourceRoutes = new Hono<AuthEnv>()
supplementarySourceRoutes.use('*', requireAdmin())
supplementarySourceRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  await next()
})
supplementarySourceRoutes.onError((err, c) =>
  c.json(
    { error: err instanceof LanzouError ? err.message : '附加源操作失败，请刷新后重试' },
    err instanceof LanzouError && err.code === 'invalid' ? 400 : 502,
  ),
)
supplementarySourceRoutes.get('/', async (c) => c.json(await supplementaryOverview(getDb())))
supplementarySourceRoutes.post('/', async (c) => {
  const id = await saveSupplementarySource(getDb(), await c.req.json())
  return c.json({ id })
})
supplementarySourceRoutes.post('/:id/check', async (c) => {
  await checkSupplementarySource(getDb(), c.req.param('id'))
  return c.json(await supplementaryOverview(getDb()))
})
supplementarySourceRoutes.get('/:id/files', async (c) => {
  const row = (await getDb().query<{ files_json: string }>('SELECT files_json FROM supplementary_sources WHERE id=$1', [c.req.param('id')])).rows[0]
  if (!row) return c.json({ error: '附加源不存在' }, 404)
  const query = (c.req.query('q') || '').trim().toLocaleLowerCase()
  const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0)
  const files = sourceFiles(row)
    .filter((f) => !query || `${f.title} ${f.author} ${f.name}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.folder.localeCompare(a.folder, 'zh-CN', { numeric: true }) || (b.revision ?? -1) - (a.revision ?? -1))
  return c.json({ items: files.slice(offset, offset + 30), total: files.length })
})
supplementarySourceRoutes.post('/bindings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  await saveSupplementaryBinding(getDb(), String(body.sourceId || ''), String(body.novelId || ''), String(body.fileKey || ''))
  return c.json(await supplementaryOverview(getDb()))
})
supplementarySourceRoutes.delete('/bindings/:id', async (c) => {
  await getDb().query('DELETE FROM supplementary_bindings WHERE id=$1', [c.req.param('id')])
  return c.json(await supplementaryOverview(getDb()))
})
