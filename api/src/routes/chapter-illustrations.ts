import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import sharp from 'sharp'
import type { ChapterIllustration, IllustrationAnchor } from '@shared/chapter-illustrations'
import { hashParagraphText } from '@shared/thought-anchor'
import { getDb } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { optionalUser, requireAdmin, type AuthEnv } from '../middlewares/auth'
import { newId } from '../services/auth'
import { contentPolicyHeaders, restrictedContentResponse, resolveContentAccess } from '../services/content-access'
import { chapterContainsSelection, selectionImageRevision } from '../services/ai/selection-image'

export const chapterIllustrationsRoutes = new Hono<AuthEnv>()
const columns = 'i.*, a.width, a.height'
const join = 'chapter_illustrations i JOIN chapter_illustration_assets a ON a.id = i.asset_id'
type Row = ChapterIllustration & Record<string, unknown>
function map(row: Record<string, unknown>): ChapterIllustration {
  return {
    id: String(row.id),
    chapterId: String(row.chapter_id),
    assetId: String(row.asset_id),
    width: Number(row.width),
    height: Number(row.height),
    caption: String(row.caption),
    size: row.size as ChapterIllustration['size'],
    anchor: row.anchor as IllustrationAnchor,
    chapterRevision: String(row.chapter_revision),
    version: Number(row.version),
    order: Number(row.sort_order),
    deleted: Boolean(row.deleted),
  }
}
async function access(c: Context<AuthEnv>, rating: string) {
  if (rating !== 'restricted') return null
  if (c.req.query('contentMode') === 'safe') return restrictedContentResponse(c, 'safe_mode')
  const decision = await resolveContentAccess(c)
  return decision.canViewRestricted ? null : restrictedContentResponse(c, decision.reason)
}
class IllustrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
  }
}
chapterIllustrationsRoutes.onError((error, c) => {
  if (error instanceof IllustrationError) return c.json({ error: error.message }, error.status)
  console.error('[chapter-illustrations]', error)
  return c.json({ error: '服务器内部错误' }, 500)
})
chapterIllustrationsRoutes.get('/:chapterId/illustrations', optionalUser(), async (c) => {
  const chapter = await first<{ content: string; content_rating: string }>(
    getDb(),
    'SELECT c.content, n.content_rating FROM chapters c JOIN novels n ON n.id=c.novel_id WHERE c.id=$1',
    [c.req.param('chapterId')],
  )
  if (!chapter) return c.json({ error: '章节不存在' }, 404)
  const denied = await access(c, chapter.content_rating)
  if (denied) return denied
  const rows = await all<Row>(getDb(), `SELECT ${columns} FROM ${join} WHERE i.chapter_id=$1 AND i.deleted=FALSE ORDER BY i.sort_order, i.id`, [
    c.req.param('chapterId'),
  ])
  return c.json(
    { illustrations: rows.map(map), chapterRevision: selectionImageRevision(chapter.content), contentHash: hashParagraphText(chapter.content) },
    200,
    contentPolicyHeaders(),
  )
})
chapterIllustrationsRoutes.get('/:chapterId/illustrations/:id/image', optionalUser(), async (c) => {
  const row = await first<{ data: Uint8Array; content_rating: string }>(
    getDb(),
    `SELECT a.data, n.content_rating FROM ${join} JOIN chapters c ON c.id=i.chapter_id JOIN novels n ON n.id=c.novel_id
     WHERE i.id=$1 AND i.chapter_id=$2 AND (i.deleted=FALSE OR $3)`,
    [c.req.param('id'), c.req.param('chapterId'), c.get('user')?.role === 'admin'],
  )
  if (!row) return c.json({ error: '插图不存在' }, 404)
  const denied = await access(c, row.content_rating)
  if (denied) return denied
  return c.body(new Uint8Array(row.data), 200, { ...contentPolicyHeaders(), 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff' })
})

const uploadLimit = bodyLimit({ maxSize: 10 * 1024 * 1024 + 65536, onError: (c) => c.json({ error: '图片不能超过 10MB' }, 413) })
chapterIllustrationsRoutes.post('/:chapterId/illustrations', requireAdmin(), uploadLimit, (c) => save(c))
chapterIllustrationsRoutes.put('/:chapterId/illustrations/:id', requireAdmin(), uploadLimit, (c) => save(c))

async function save(c: Context<AuthEnv>) {
  const form = await c.req.formData().catch(() => {
    throw new IllustrationError('上传格式不正确')
  })
  let input: Record<string, unknown>
  try {
    input = JSON.parse(String(form.get('metadata')))
  } catch {
    throw new IllustrationError('插图信息不正确')
  }
  if (!input || typeof input !== 'object') throw new IllustrationError('插图信息不正确')
  const anchor = input.anchor as IllustrationAnchor
  if (
    !anchor ||
    !['start', 'after', 'end'].includes(anchor.position) ||
    !Number.isInteger(anchor.paragraphIndex) ||
    !Number.isInteger(anchor.sourceIndex) ||
    ['paragraphText', 'paragraphHash', 'previousText', 'nextText', 'sourceHash'].some((key) => typeof anchor[key as keyof IllustrationAnchor] !== 'string')
  ) {
    throw new IllustrationError('请选择有效的插图位置')
  }
  if (typeof input.caption !== 'string' || input.caption.length > 500 || !['medium', 'full'].includes(String(input.size)))
    throw new IllustrationError('图注最多 500 字，请选择有效的尺寸')
  const file = form.get('image')
  let image: { data: Buffer; width: number; height: number } | undefined
  if (file !== null) {
    if (typeof file === 'string' || !file.size || file.size > 10 * 1024 * 1024) throw new IllustrationError('请选择不超过 10MB 的图片')
    try {
      const bytes = Buffer.from(await file.arrayBuffer())
      const source = sharp(bytes, { limitInputPixels: 40_000_000, animated: false })
      const meta = await source.metadata()
      if (!['jpeg', 'png', 'webp', 'avif'].includes(meta.format || '')) throw new Error('format')
      const output = await source
        .rotate()
        .resize({ width: 2400, height: 4000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true })
      image = { data: output.data, width: output.info.width, height: output.info.height }
    } catch {
      throw new IllustrationError('图片无法读取，请使用 JPG、PNG、WebP 或 AVIF 图片')
    }
  }
  const chapterId = c.req.param('chapterId')!
  const id = c.req.param('id') || newId('illustration')
  const updating = c.req.method === 'PUT'
  const illustration = await withTx(getDb(), async (query) => {
    const chapter = (await query<{ content: string }>('SELECT content FROM chapters WHERE id=$1 FOR UPDATE', [chapterId])).rows[0]
    if (!chapter) throw new IllustrationError('章节不存在', 404)
    const revision = selectionImageRevision(chapter.content)
    if (input.chapterRevision !== revision) throw new IllustrationError('正文已变更，请重新加载章节后选择位置', 409)
    if (
      input.deleted !== true &&
      anchor.position === 'after' &&
      (anchor.paragraphIndex < 0 ||
        hashParagraphText(anchor.paragraphText) !== anchor.paragraphHash ||
        !chapterContainsSelection(chapter.content, anchor.paragraphText, anchor.sourceIndex, anchor.sourceHash))
    ) {
      throw new IllustrationError('段落已变更，请重新选择插图位置', 409)
    }
    const previous = updating
      ? (await query<Row>('SELECT * FROM chapter_illustrations WHERE id=$1 AND chapter_id=$2 FOR UPDATE', [id, chapterId])).rows[0]
      : undefined
    if (updating && !previous) throw new IllustrationError('插图不存在', 404)
    if (previous && input.version !== Number(previous.version)) throw new IllustrationError('插图已被其他管理员修改，请刷新后重试', 409)
    let assetId = previous?.asset_id
    if (input.assetId && previous) {
      const asset = (await query('SELECT id FROM chapter_illustration_assets WHERE id=$1 AND chapter_id=$2', [input.assetId, chapterId])).rows[0]
      if (!asset) throw new IllustrationError('原图片不存在', 404)
      assetId = input.assetId
    }
    if (image) {
      assetId = newId('illustration_asset')
      await query('INSERT INTO chapter_illustration_assets(id,chapter_id,data,width,height,created_at) VALUES($1,$2,$3,$4,$5,$6)', [
        assetId,
        chapterId,
        image.data,
        image.width,
        image.height,
        Date.now(),
      ])
    }
    if (!assetId) throw new IllustrationError('请先添加图片')
    const order =
      previous?.sort_order ??
      Number(
        (await query<{ value: number }>('SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM chapter_illustrations WHERE chapter_id=$1', [chapterId])).rows[0]!
          .value,
      )
    if (previous) {
      await query(
        'UPDATE chapter_illustrations SET asset_id=$1,caption=$2,size=$3,anchor=$4,chapter_revision=$5,version=version+1,deleted=$6,updated_at=$7 WHERE id=$8',
        [assetId, input.caption, input.size, JSON.stringify(anchor), revision, input.deleted === true, Date.now(), id],
      )
    } else {
      await query(
        'INSERT INTO chapter_illustrations(id,chapter_id,asset_id,caption,size,anchor,chapter_revision,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)',
        [id, chapterId, assetId, input.caption, input.size, JSON.stringify(anchor), revision, order, Date.now()],
      )
    }
    return map((await query<Row>(`SELECT ${columns} FROM ${join} WHERE i.id=$1`, [id])).rows[0]!)
  })
  return c.json({ illustration }, updating ? 200 : 201, contentPolicyHeaders())
}
