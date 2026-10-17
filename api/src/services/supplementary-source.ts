import { randomUUID } from 'node:crypto'
import type { SupplementaryBinding, SupplementaryFile, SupplementaryOverview, SupplementarySource } from '@shared/supplementary-source'
import type { Db } from '../db/pool'
import { all, first } from '../db/query'
import { identityKey, normalizeLanzouFolderUrl, scanLanzouFolder, LanzouError } from './lanzou'

interface SourceRow {
  id: string
  name: string
  url: string
  password: string
  enabled: boolean
  interval_hours: number
  checked_at: number
  next_check_at: number
  status: SupplementarySource['status']
  error: string
  files_json: string
  revision: number
  checking_until: number
}
interface BindingRow {
  id: string
  source_id: string
  novel_id: string
  alias_title: string
  alias_author: string
  novel_title: string
}
export function sourceFiles(source: Pick<SourceRow, 'files_json'>): SupplementaryFile[] {
  try {
    const files = JSON.parse(source.files_json)
    return Array.isArray(files) ? files : []
  } catch {
    return []
  }
}
function publicSource(s: SourceRow): SupplementarySource {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    hasPassword: !!s.password,
    enabled: s.enabled,
    intervalHours: s.interval_hours,
    checkedAt: Number(s.checked_at),
    nextCheckAt: Number(s.next_check_at),
    status: s.status,
    error: s.error,
    fileCount: sourceFiles(s).length,
  }
}
export function bindingCandidates(files: SupplementaryFile[], title: string, author: string): SupplementaryFile[] {
  return files
    .filter((f) => identityKey(f.title) === identityKey(title) && identityKey(f.author) === identityKey(author))
    .sort((a, b) => b.folder.localeCompare(a.folder, 'zh-CN', { numeric: true }) || (b.revision ?? -1) - (a.revision ?? -1) || a.key.localeCompare(b.key))
}
export async function supplementaryOverview(db: Db): Promise<SupplementaryOverview> {
  const sources = await all<SourceRow>(db, 'SELECT * FROM supplementary_sources ORDER BY name,id')
  const bindings = await all<BindingRow>(
    db,
    'SELECT b.*,n.title AS novel_title FROM supplementary_bindings b JOIN novels n ON n.id=b.novel_id ORDER BY n.title,b.id',
  )
  const files = new Map(sources.map((s) => [s.id, sourceFiles(s)]))
  return {
    sources: sources.map(publicSource),
    bindings: bindings.map((b) => ({
      id: b.id,
      sourceId: b.source_id,
      novelId: b.novel_id,
      novelTitle: b.novel_title,
      aliasTitle: b.alias_title,
      aliasAuthor: b.alias_author,
      candidates: bindingCandidates(files.get(b.source_id) || [], b.alias_title, b.alias_author).slice(0, 10),
    })),
  }
}
export async function saveSupplementarySource(db: Db, input: Record<string, unknown>): Promise<string> {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const name = String(input.name || '').trim()
  const url = normalizeLanzouFolderUrl(String(input.url || ''))
  const interval = Number(input.intervalHours ?? 6)
  if (!name || name.length > 80) throw new LanzouError('来源名称需为 1–80 个字符', 'invalid')
  if (!Number.isInteger(interval) || interval < 1 || interval > 168) throw new LanzouError('检查间隔需为 1–168 小时', 'invalid')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new LanzouError('定时检查设置无效', 'invalid')
  if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 100)) throw new LanzouError('提取码格式无效', 'invalid')
  const duplicate = await first<{ id: string }>(db, 'SELECT id FROM supplementary_sources WHERE url=$1 AND id<>$2', [url, id])
  if (duplicate) throw new LanzouError('这个目录已经添加，请直接选择已有来源', 'invalid')
  if (id) {
    const old = await first<SourceRow>(db, 'SELECT * FROM supplementary_sources WHERE id=$1', [id])
    if (!old) throw new LanzouError('附加源不存在', 'invalid')
    const changed = old.url !== url || (input.password !== undefined && input.password !== old.password)
    const result = await db.query(
      `UPDATE supplementary_sources SET name=$2,url=$3,password=$4,enabled=$5,interval_hours=$6,next_check_at=$7,files_json=$8,status=$9,error='',checked_at=$10,revision=revision+1 WHERE id=$1 AND revision=$11 AND checking_until<=$12`,
      [
        id,
        name,
        url,
        input.password === undefined ? old.password : input.password,
        input.enabled ?? old.enabled,
        interval,
        Date.now() + interval * 3600000,
        changed ? '[]' : old.files_json,
        changed ? 'never' : old.status,
        changed ? 0 : old.checked_at,
        old.revision,
        Date.now(),
      ],
    )
    if (!result.rowCount) throw new LanzouError('来源正在检查或已变化，请刷新后重试', 'invalid')
    return id
  }
  const newId = randomUUID()
  await db.query('INSERT INTO supplementary_sources (id,name,url,password,enabled,interval_hours,next_check_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    newId,
    name,
    url,
    input.password || '',
    input.enabled === true,
    interval,
    Date.now() + interval * 3600000,
  ])
  return newId
}
export async function checkSupplementarySource(db: Db, id: string, scan = scanLanzouFolder): Promise<void> {
  const now = Date.now()
  const row = (
    await db.query<SourceRow>(
      'UPDATE supplementary_sources SET checking_until=$2,next_check_at=$3+interval_hours*3600000 WHERE id=$1 AND checking_until<=$3 RETURNING *',
      [id, now + 180000, now],
    )
  ).rows[0]
  if (!row) throw new LanzouError('来源不存在或正在检查，请稍后刷新', 'invalid')
  try {
    const failedFolders: string[] = []
    const files = await scan(row.url, row.password, undefined, failedFolders)
    const retained = sourceFiles(row)
      .filter((f) => failedFolders.some((folder) => f.folder === folder || f.folder.startsWith(folder + '/')))
      .map((f) => ({ ...f, stale: true }))
    const merged = [...new Map([...retained, ...files].map((f) => [f.key, f])).values()]
    if (merged.length > 5000) throw new LanzouError('累计文件过多，请绑定更具体的目录')
    const error = failedFolders.length ? `以下目录未完整读取：${failedFolders.join('、')}。这些目录保留上次清单，尚不能确认有无更新` : ''
    await db.query('UPDATE supplementary_sources SET files_json=$2,status=$5,error=$6,checked_at=$3,checking_until=0 WHERE id=$1 AND revision=$4', [
      id,
      JSON.stringify(merged),
      Date.now(),
      row.revision,
      failedFolders.length ? 'partial' : 'ok',
      error,
    ])
  } catch (error) {
    const message = error instanceof LanzouError ? error.message : '目录检查失败，请稍后重试'
    await db.query("UPDATE supplementary_sources SET status='error',error=$2,checked_at=$3,checking_until=0 WHERE id=$1 AND revision=$4", [
      id,
      message,
      Date.now(),
      row.revision,
    ])
    throw new LanzouError(message, error instanceof LanzouError ? error.code : 'failed')
  }
}
export async function saveSupplementaryBinding(db: Db, sourceId: string, novelId: string, fileKey: string): Promise<void> {
  const source = await first<SourceRow>(db, 'SELECT * FROM supplementary_sources WHERE id=$1', [sourceId])
  const novel = await first<{ id: string }>(db, 'SELECT id FROM novels WHERE id=$1', [novelId])
  const file = source ? sourceFiles(source).find((f) => f.key === fileKey) : undefined
  if (!novel || !file || !file.title) throw new LanzouError('作品或候选文件不存在，请重新检查后选择', 'invalid')
  await db.query(
    'INSERT INTO supplementary_bindings (id,source_id,novel_id,alias_title,alias_author) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_id,novel_id,alias_title,alias_author) DO NOTHING',
    [randomUUID(), sourceId, novelId, file.title, file.author],
  )
}
export async function boundSupplementaryFile(db: Db, bindingId: string, fileKey: string): Promise<{ binding: SupplementaryBinding; file: SupplementaryFile }> {
  const overview = await supplementaryOverview(db)
  const binding = overview.bindings.find((b) => b.id === bindingId)
  const source = binding ? await first<SourceRow>(db, 'SELECT * FROM supplementary_sources WHERE id=$1', [binding.sourceId]) : null
  const file = source && binding ? bindingCandidates(sourceFiles(source), binding.aliasTitle, binding.aliasAuthor).find((f) => f.key === fileKey) : undefined
  if (!binding || !file) throw new LanzouError('绑定或文件已变化，请刷新附加源后重试', 'invalid')
  return { binding, file }
}
/** 每个共享来源只调度一次；只检查目录，不下载、发布章节。 */
export async function runSupplementaryTick(db: Db) {
  const due = await all<{ id: string }>(
    db,
    'SELECT id FROM supplementary_sources WHERE enabled=TRUE AND next_check_at<=$1 AND checking_until<=$1 ORDER BY next_check_at LIMIT 2',
    [Date.now()],
  )
  for (const source of due) {
    try {
      await checkSupplementarySource(db, source.id)
    } catch {
      /* 失败状态已保存，下个周期重试。 */
    }
  }
}
