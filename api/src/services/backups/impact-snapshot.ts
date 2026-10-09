import { createHash } from 'node:crypto'
import type { Db, DbClient } from '../../db/pool'
import type { BackupImpactChange, BackupImpactCounts, BackupImpactGroup, BackupImpactItem, BackupImpactSummary } from '@shared/backups'
import { BACKUP_IMPACT_GROUPS } from '@shared/backups'
import { BackupError } from './config'

// 会话会在恢复时统一失效；迁移版本另行绑定，不比较其应用时间。
const excluded = new Set(['user_sessions', 'schema_migrations'])
// 这些运行记录仍会回到备份状态，但查看报告/提交恢复产生的审计不应让业务影响过期。
export const volatileTables = new Set([
  'site_visits',
  'download_logs',
  'login_audit',
  'admin_operation_audit',
  'mobile_telemetry',
  'api_idempotency',
  'login_failures',
  'content_request_limits',
])
const assets = new Set(['novel_covers', 'user_avatars', 'novel_cover_history', 'thought_images', 'chapter_illustration_assets'])
const safeFields: Record<string, Record<string, string>> = {
  novels: { title: '书名', author: '作者', status: '连载状态', chapter_count: '章节数量', categories: '分类' },
  chapters: { title: '章节标题', novel_id: '所属小说', sort_order: '章节顺序', word_count: '字数' },
  users: { username: '用户名', display_name: '显示名称', role: '角色', status: '账户状态' },
}
// 仅用于字段名称；原值始终留在数据库中，比较结果只生成变化标签。
const fieldLabels: Record<string, string> = {
  id: '记录标识',
  created_at: '创建时间',
  updated_at: '更新时间',
  description: '简介',
  bio: '个人简介',
  cover_url: '封面地址',
  source_url: '来源地址',
  remote_chapter_count: '来源章节总数',
  public_chapter_count: '公开章节数量',
  protected_chapter_count: '受保护章节数量',
  update_checked_at: '最近更新检查时间',
  source_chapter_snapshot: '来源目录快照',
  content_rating: '内容分级',
  content_rating_revision: '内容分级版本',
  content_rating_source: '内容分级来源',
  content_rating_reason: '内容分级原因',
  content_rating_evidence: '内容分级依据',
  content_rating_rule_version: '内容分级规则版本',
  content_rating_updated_by: '内容分级操作人',
  content_rating_updated_at: '内容分级更新时间',
  content_rating_operation_id: '内容分级操作记录',
  content: '正文内容',
  source_type: '章节来源类型',
  ai_task_id: '关联 AI 任务',
  password_hash: '密码认证信息（内容隐藏）',
  password_salt: '密码认证信息（内容隐藏）',
  password_iterations: '密码认证参数（内容隐藏）',
  reader_settings: '阅读偏好',
  data: '图片内容',
  content_type: '图片格式',
  prompt: '图片生成提示词（内容隐藏）',
  metadata: '资源元数据',
  novel_id: '所属小说',
  user_id: '所属用户',
  value: '配置值',
  key: '配置名称',
}
function changedFieldLabels(table: string, before: SnapshotRow, after: SnapshotRow): string[] {
  const keys = new Set([...Object.keys(before.field_signatures), ...Object.keys(after.field_signatures)])
  return [
    ...new Set(
      [...keys]
        .filter((key) => before.field_signatures[key] !== after.field_signatures[key])
        .map((key) => safeFields[table]?.[key] || fieldLabels[key] || `字段 ${key}（内容隐藏）`),
    ),
  ]
}
const safeSettingKeys = new Set(['invite_required', 'adult_content_enabled'])
export interface SnapshotTable {
  name: string
  keys: string[]
  columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>
}
export interface SnapshotRow {
  key: string
  signature: string
  quantity: number
  visible: Record<string, unknown>
  field_signatures: Record<string, string>
  bytes: number
}
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'"
const digestSql = (value: string) => `encode(sha256(convert_to(${value},'UTF8')),'hex')`
const compareKeys = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right))
export const impactCounts = (): BackupImpactCounts => ({ current: 0, restored: 0, added: 0, modified: 0, removed: 0, currentBytes: 0, restoredBytes: 0 })
export function impactGroup(table: string): BackupImpactGroup {
  return table === 'novels'
    ? 'novels'
    : table === 'chapters' || table === 'chapter_illustrations'
      ? 'chapters'
      : table === 'users'
        ? 'users'
        : table === 'app_settings'
          ? 'settings'
          : assets.has(table)
            ? 'assets'
            : 'other'
}
export function impactSummary(): BackupImpactSummary {
  return {
    groups: Object.fromEntries(BACKUP_IMPACT_GROUPS.map((key) => [key, impactCounts()])) as BackupImpactSummary['groups'],
    tables: [],
    schemaChanges: [],
  }
}
function settingValue(row?: SnapshotRow): string {
  if (!row) return '不存在'
  const key = String(row.visible.key || '')
  const value = row.visible.value
  if (key === 'site_branding') {
    try {
      const branding = JSON.parse(String(value)) as Record<string, unknown>
      return JSON.stringify(
        Object.fromEntries(
          ['name', 'tagline', 'homeTitle', 'description', 'logoUrl', 'faviconUrl']
            .filter((field) => typeof branding[field] === 'string')
            .map((field) => [field, String(branding[field]).slice(0, 300)]),
        ),
      ).slice(0, 1000)
    } catch {
      return '格式无法展示'
    }
  }
  return safeSettingKeys.has(key) ? (value === null ? '格式无法展示' : String(value ?? '').slice(0, 300)) : '已配置（内容隐藏）'
}
export function impactItem(
  table: string,
  change: BackupImpactChange,
  before: SnapshotRow | undefined,
  after: SnapshotRow | undefined,
  quantity = 1,
): Omit<BackupImpactItem, 'sequence'> {
  const row = after || before!
  const group = impactGroup(table)
  let name = `${table} 记录`
  const changedFields: string[] = []
  if (safeFields[table]) {
    name = String(row.visible.title || row.visible.display_name || row.visible.username || `${table} 记录`).slice(0, 200)
    if (change === 'modify') {
      changedFields.push(...changedFieldLabels(table, before!, after!))
      if (!changedFields.length) changedFields.push(table === 'users' ? '其他账户信息（含认证信息，内容隐藏）' : '其他记录信息')
    }
  } else if (group === 'assets') {
    name = `${table} 图片资源`
    if (change === 'modify') changedFields.push(...changedFieldLabels(table, before!, after!))
  } else if (group === 'settings') {
    name = String(row.visible.key || '配置项').slice(0, 200)
    if (change === 'modify') changedFields.push(...changedFieldLabels(table, before!, after!))
  } else if (change === 'modify') changedFields.push('记录内容（不展示原始值）')
  return {
    group,
    table,
    change,
    name,
    quantity,
    changedFields,
    ...(group === 'settings' ? { currentValue: settingValue(before), restoredValue: settingValue(after) } : {}),
    ...(table === 'chapters' && row.visible.novel_title ? { relatedName: String(row.visible.novel_title).slice(0, 200) } : {}),
  }
}
async function tableList(client: DbClient): Promise<SnapshotTable[]> {
  const result = await client.query<SnapshotTable>(`SELECT c.relname AS name,
    COALESCE((SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary), ARRAY[]::text[]) AS keys,
    (SELECT json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY c.relname COLLATE "C"`)
  return result.rows.filter((table) => !excluded.has(table.name))
}
function selectRows(table: SnapshotTable): string {
  const relation = `public.${quote(table.name)}`
  const names = new Set(table.columns.map((column) => column.name))
  const json = table.name === 'users' ? "(to_jsonb(t)-'last_login_at')::text" : 'to_jsonb(t)::text'
  const signature = digestSql(json)
  if (!table.keys.length)
    return `SELECT (${signature} COLLATE "C") AS key,${signature} AS signature,count(*)::int AS quantity,'{}'::jsonb AS visible,'{}'::jsonb AS field_signatures,0::bigint AS bytes FROM ${relation} t GROUP BY 1,2 ORDER BY 1`
  const key = `jsonb_build_array(${table.keys.map((name) => `to_jsonb(t.${quote(name)})`).join(',')})::text`
  const fields = Object.keys(safeFields[table.name] || {})
    .filter((name) => names.has(name))
    .flatMap((name) => [literal(name), `t.${quote(name)}`])
  if (table.name === 'chapters' && names.has('novel_id')) fields.push("'novel_title'", '(SELECT n.title FROM public.novels n WHERE n.id=t.novel_id)')
  if (table.name === 'app_settings') {
    // 在数据库侧白名单投影，秘密配置的原始值不会传到 Node 或持久化详情。
    const allowed = [...safeSettingKeys].map(literal).join(',')
    const branding = `jsonb_strip_nulls(jsonb_build_object(${['name', 'tagline', 'homeTitle', 'description', 'logoUrl', 'faviconUrl'].flatMap((key) => [literal(key), `CASE WHEN jsonb_typeof(t.value::jsonb->${literal(key)})='string' THEN t.value::jsonb->>${literal(key)} ELSE NULL END`]).join(',')}))::text`
    fields.push(
      "'key'",
      't.key',
      "'value'",
      `CASE WHEN t.key='site_branding' THEN ${branding} WHEN t.key IN (${allowed}) AND t.value IN ('true','false','0','1') THEN t.value ELSE NULL END`,
    )
  }
  const visible = fields.length ? `jsonb_build_object(${fields.join(',')})` : "'{}'::jsonb"
  const comparedFields =
    safeFields[table.name] || assets.has(table.name) || table.name === 'app_settings'
      ? table.columns.filter((column) => !(table.name === 'users' && column.name === 'last_login_at'))
      : []
  const fieldSignatures = comparedFields.length
    ? `jsonb_build_object(${comparedFields.flatMap((column) => [literal(column.name), digestSql(`COALESCE(to_jsonb(t.${quote(column.name)})::text,'null')`)]).join(',')})`
    : "'{}'::jsonb"
  const bytes = assets.has(table.name) && names.has('data') ? 'octet_length(t.data)::bigint' : '0::bigint'
  return `SELECT (${key} COLLATE "C") AS key,${signature} AS signature,1::int AS quantity,${visible} AS visible,${fieldSignatures} AS field_signatures,${bytes} AS bytes FROM ${relation} t ORDER BY 1`
}
async function* rows(client: DbClient, table: SnapshotTable, cursor: string): AsyncGenerator<SnapshotRow> {
  await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${selectRows(table)}`)
  try {
    for (;;) {
      const page = await client.query<SnapshotRow>(`FETCH FORWARD 500 FROM ${cursor}`)
      if (!page.rows.length) break
      for (const row of page.rows) yield { ...row, bytes: Number(row.bytes), quantity: Number(row.quantity) }
    }
  } finally {
    await client.query(`CLOSE ${cursor}`).catch(() => {})
  }
}
async function openSnapshot(db: Db) {
  const client = await db.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout='60s'")
    await client.query("SET LOCAL lock_timeout='5s'")
    const snapshotAt = Date.now()
    const tables = await tableList(client)
    return {
      client,
      tables,
      snapshotAt,
      close: async () => {
        try {
          await client.query('ROLLBACK')
        } finally {
          client.release()
        }
      },
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
    throw error
  }
}
function fingerprintTable(hash: ReturnType<typeof createHash>, table: SnapshotTable) {
  if (!volatileTables.has(table.name)) hash.update(JSON.stringify(table))
}
function fingerprintRow(hash: ReturnType<typeof createHash>, table: SnapshotTable, row: SnapshotRow) {
  if (!volatileTables.has(table.name)) hash.update(JSON.stringify([row.key, row.signature, row.quantity]))
}
export async function liveImpactFingerprint(db: Db): Promise<string> {
  const snapshot = await openSnapshot(db)
  const hash = createHash('sha256')
  try {
    for (const table of snapshot.tables) {
      if (volatileTables.has(table.name)) continue
      fingerprintTable(hash, table)
      for await (const row of rows(snapshot.client, table, 'impact_fingerprint')) fingerprintRow(hash, table, row)
    }
    return hash.digest('hex')
  } finally {
    await snapshot.close()
  }
}
export async function compareImpactSnapshots(
  db: Db,
  shadow: Db,
  emit: (item: Omit<BackupImpactItem, 'sequence'>) => Promise<void>,
): Promise<{ summary: BackupImpactSummary; fingerprint: string; snapshotAt: number }> {
  const live = await openSnapshot(db)
  let target: Awaited<ReturnType<typeof openSnapshot>> | undefined
  const hash = createHash('sha256'),
    summary = impactSummary()
  try {
    target = await openSnapshot(shadow)
    const currentTables = new Map(live.tables.map((table) => [table.name, table]))
    const restoredTables = new Map(target.tables.map((table) => [table.name, table]))
    const names = [...new Set([...currentTables.keys(), ...restoredTables.keys()])].sort(compareKeys)
    for (const name of names) {
      const current = currentTables.get(name),
        restored = restoredTables.get(name)
      if (!current || !restored || JSON.stringify(current) !== JSON.stringify(restored))
        summary.schemaChanges.push({ table: name, change: !current ? 'add' : !restored ? 'remove' : 'modify' })
      const group = impactGroup(name),
        counts = impactCounts()
      if (current) fingerprintTable(hash, current)
      const beforeRows = current ? rows(live.client, current, 'impact_current') : null
      const afterRows = restored ? rows(target.client, restored, 'impact_restored') : null
      let before = beforeRows ? ((await beforeRows.next()).value as SnapshotRow | undefined) : undefined
      let after = afterRows ? ((await afterRows.next()).value as SnapshotRow | undefined) : undefined
      const takeBefore = async () => {
        if (before) {
          fingerprintRow(hash, current!, before)
          counts.current += before.quantity
          counts.currentBytes += before.bytes * before.quantity
        }
        before = beforeRows ? ((await beforeRows.next()).value as SnapshotRow | undefined) : undefined
      }
      const takeAfter = async () => {
        if (after) {
          counts.restored += after.quantity
          counts.restoredBytes += after.bytes * after.quantity
        }
        after = afterRows ? ((await afterRows.next()).value as SnapshotRow | undefined) : undefined
      }
      while (before || after) {
        const order = !before ? 1 : !after ? -1 : compareKeys(before.key, after.key)
        if (order < 0) {
          counts.removed += before!.quantity
          await emit(impactItem(name, 'remove', before, undefined, before!.quantity))
          await takeBefore()
        } else if (order > 0) {
          counts.added += after!.quantity
          await emit(impactItem(name, 'add', undefined, after, after!.quantity))
          await takeAfter()
        } else {
          if (before!.signature !== after!.signature) {
            counts.modified++
            await emit(impactItem(name, 'modify', before, after))
          }
          const delta = after!.quantity - before!.quantity
          if (delta) {
            const change = delta > 0 ? 'add' : 'remove'
            counts[delta > 0 ? 'added' : 'removed'] += Math.abs(delta)
            await emit(impactItem(name, change, delta < 0 ? before : undefined, delta > 0 ? after : undefined, Math.abs(delta)))
          }
          await takeBefore()
          await takeAfter()
        }
      }
      summary.tables.push({ ...counts, name, group, stableIds: Boolean(current?.keys.length || restored?.keys.length) })
      for (const key of Object.keys(counts) as Array<keyof BackupImpactCounts>) summary.groups[group][key] += counts[key]
    }
    return { summary, fingerprint: hash.digest('hex'), snapshotAt: live.snapshotAt }
  } catch (error) {
    if (error instanceof BackupError) throw error
    const failure = new BackupError('IMPACT_UNAVAILABLE', '回滚影响分析未完成，请检查数据库权限或重新预检；不能继续回滚')
    failure.cause = error
    throw failure
  } finally {
    await Promise.allSettled([target?.close(), live.close()])
  }
}
