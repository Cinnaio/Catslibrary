import { createHash } from 'node:crypto'
import { STUDIO_KINDS, STUDIO_DEFINITIONS, studioScope, type StudioCard, type StudioCardInput, type StudioEvidence, type StudioSnapshot, type StudioKind } from '@shared/ai-writing-studio'
import type { Db, DbClient } from '../../db/pool'
import { all, first, withTx } from '../../db/query'
import { newId } from '../auth'
import { AiError } from './client'
import { saveGeneration } from './generations'
import { createAiTask, updateAiTask } from './tasks'

interface Session { id: string; user_id: string; novel_id: string; after_chapter_id: string; active_task_id: string }
interface Row { id: string; card: StudioCard; operation_id: string | null }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const invalid = (message: string): never => { throw new AiError('invalid', message, 422) }
const conflict = (message: string): never => { throw new AiError('conflict', message, 409) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('写作工坊内容格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return invalid('请完整填写内容，并遵守字数限制')
  return value.trim()
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return invalid('请提供当前内容版本')
  return value
}
export function parseStudioCard(raw: unknown): StudioCardInput {
  const value = object(raw)
  const kind = value.kind as StudioKind
  if (!STUDIO_KINDS.includes(kind)) return invalid('不支持的写作工坊类别')
  const scope = value.scope === 'personal' && kind === 'preference' ? 'personal' : studioScope(kind)
  if (value.scope !== scope) return invalid('这类写作资料不能保存在所选范围')
  const fields = object(value.values)
  const values: Record<string, string> = {}
  for (const field of STUDIO_DEFINITIONS[kind].fields) {
    values[field.key] = text(fields[field.key] ?? '', field.limit, field.required)
    if (field.options && !field.options.includes(values[field.key]!)) return invalid('请选择有效的认知状态')
  }
  if (kind === 'scene' && values.targetWords && (!/^\d+$/.test(values.targetWords) || Number(values.targetWords) < 1 || Number(values.targetWords) > 12000))
    return invalid('每场预计字数须为 1 至 12000')
  if (!Number.isSafeInteger(value.position) || Number(value.position) < 0 || Number(value.position) > 9999) return invalid('场景顺序须为 0 至 9999')
  if (!Array.isArray(value.evidence) || value.evidence.length > 8) return invalid('每项最多附八条来源')
  const evidence = value.evidence.map((input): StudioEvidence => {
    const item = object(input)
    if (!['chapter', 'draft', 'scene', 'edit'].includes(String(item.kind))) return invalid('来源类型无效')
    return { kind: item.kind as StudioEvidence['kind'], id: text(item.id, 180, true), revision: text(item.revision, 180, true),
      quote: text(item.quote, 800, true), ...(item.beforeQuote === undefined ? {} : { beforeQuote: text(item.beforeQuote, 800, true) }) }
  })
  if (JSON.stringify(values).length > 18000) return invalid('单项内容过长，请分成多张卡片')
  return { kind, scope, title: text(value.title, 160, true), values, evidence, position: Number(value.position) }
}
async function sessionFor(db: DbClient, userId: string, sessionId: string, lock = false): Promise<Session> {
  const session = await first<Session>(db, 'SELECT id,user_id,novel_id,after_chapter_id,active_task_id FROM ai_agent_sessions WHERE id=$1 AND user_id=$2' + (lock ? ' FOR UPDATE' : ''), [sessionId, userId])
  if (!session) throw new AiError('invalid', '创作对话不存在', 404)
  return session
}
const scopeSql = `(scope='personal' OR (novel_id=$2 AND (scope='book' OR session_id=$3)))`
async function cardFor(db: DbClient, session: Session, id: string): Promise<StudioCard> {
  const row = await first<Row>(db, `SELECT id,card FROM ai_writing_cards WHERE user_id=$1 AND ${scopeSql} AND id=$4`, [session.user_id, session.novel_id, session.id, id])
  if (!row) throw new AiError('invalid', '写作资料不存在或不属于当前范围', 404)
  return row.card
}
async function writable(db: DbClient, session: Session, proposal?: { taskId: string }) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.user_id])
  const active = await first(db, "SELECT id FROM ai_tasks WHERE id=$1 AND user_id=$2 AND kind='agent_chat' AND status IN ('queued','running')", [session.active_task_id, session.user_id])
  if (proposal ? !active || proposal.taskId !== session.active_task_id : !!active)
    conflict(proposal ? '本轮对话已结束，请重新提出建议' : '请等待助手完成或停止后再调整写作资料')
}

/** Only owned, scoped, real text can be cited. All revisions cover the complete source. */
async function sourceFor(db: DbClient, session: Session, kind: StudioEvidence['kind'], id: string, personal = false) {
  if (kind === 'chapter') {
    const row = await first<{ title: string; content: string }>(db, `SELECT c.title,c.content FROM chapters c
      WHERE c.id=$1 AND c.novel_id=$2 AND (EXISTS(SELECT 1 FROM chapters a WHERE a.id=$3 AND a.novel_id=c.novel_id AND c.sort_order<=a.sort_order)
      OR EXISTS(SELECT 1 FROM ai_agent_actions p WHERE p.session_id=$4 AND p.kind='publish_draft' AND p.status='completed' AND p.result->>'chapterId'=c.id))`,
    [id, session.novel_id, session.after_chapter_id, session.id])
    if (row) return { title: row.title, content: row.content, before: '', revision: digest(row.content) }
  } else if (kind === 'draft') {
    const row = await first<{ result: string }>(db, "SELECT result FROM ai_generations WHERE id=$1 AND novel_id=$2 AND created_by=$3 AND deleted_at=0 AND kind IN ('continue','write_chapter')", [id, session.novel_id, session.user_id])
    if (row) return { title: '章节草稿', content: row.result, before: '', revision: digest(row.result) }
  } else if (kind === 'scene') {
    const row = await first<Row>(db, "SELECT id,card FROM ai_writing_cards WHERE id=$1 AND user_id=$2 AND session_id=$3 AND kind='scene' AND status='active'", [id, session.user_id, session.id])
    if (row) return { title: row.card.title, content: row.card.values.prose || '', before: '', revision: String(row.card.revision) }
  } else if (kind === 'edit') {
    const sample = await first<{ before_text: string; after_text: string }>(db,
      'SELECT before_text,after_text FROM ai_writing_edit_samples WHERE id=$1 AND user_id=$2 AND ($4::boolean OR novel_id=$3)', [id, session.user_id, session.novel_id, personal])
    if (sample) return { title: '已保存的草稿修改', content: sample.after_text, before: sample.before_text, revision: digest([sample.before_text, sample.after_text]) }

    const row = await first<{ title: string; payload: { before?: string; after?: string } }>(db, `SELECT a.title,a.payload FROM ai_agent_actions a JOIN ai_agent_sessions s ON s.id=a.session_id
      WHERE a.id=$1 AND s.user_id=$2 AND ($4::boolean OR s.novel_id=$3) AND a.status='completed' AND a.kind IN ('apply_rewrite','apply_chapter_edit')`, [id, session.user_id, session.novel_id, personal])
    if (row && typeof row.payload.before === 'string' && typeof row.payload.after === 'string')
      return { title: row.title, content: row.payload.after, before: row.payload.before, revision: digest([row.payload.before, row.payload.after]) }
  }
  throw new AiError('invalid', '来源不存在、已删除或不在当前可阅读范围', 404)
}
async function evidenceCurrent(db: DbClient, session: Session, card: StudioCardInput): Promise<boolean> {
  for (const evidence of card.evidence) {
    if (card.kind === 'scene' && 'id' in card && evidence.kind === 'scene' && evidence.id === card.id) {
      const version = await first<{ card: StudioCard }>(db, 'SELECT card FROM ai_writing_card_versions WHERE card_id=$1 AND revision=$2', [evidence.id, Number(evidence.revision)])
      if (!version?.card.values.prose?.includes(evidence.quote)) return false
      continue
    }
    let source: Awaited<ReturnType<typeof sourceFor>>
    try { source = await sourceFor(db, session, evidence.kind, evidence.id, card.scope === 'personal') }
    catch (error) { if (error instanceof AiError && error.status === 404) return false; throw error }
    if (source.revision !== evidence.revision || !source.content.includes(evidence.quote) ||
      (evidence.beforeQuote && !source.before.includes(evidence.beforeQuote))) return false
  }
  return true
}
export async function readStudioSource(db: DbClient, userId: string, sessionId: string, kind: StudioEvidence['kind'], id: string, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) return invalid('阅读位置无效')
  if (!['chapter', 'draft', 'scene', 'edit'].includes(kind)) return invalid('来源类型无效')
  const source = await sourceFor(db, await sessionFor(db, userId, sessionId), kind, id)
  return { ...source, id, kind, content: source.content.slice(offset, offset + 6000), before: source.before.slice(offset, offset + 6000), offset,
    nextOffset: Math.max(source.content.length, source.before.length) > offset + 6000 ? offset + 6000 : null }
}
export async function readWritingEdits(db: DbClient, userId: string, sessionId: string, offset = 0) {
  const session = await sessionFor(db, userId, sessionId)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return invalid('分页位置无效')
  const rows = await all<{ id: string; title: string; before_text: string; after_text: string }>(db, `SELECT id,title,before_text,after_text FROM (
    SELECT e.id,'已保存的草稿修改' AS title,e.before_text,e.after_text,e.created_at FROM ai_writing_edit_samples e WHERE e.user_id=$1 AND e.novel_id=$2
    UNION ALL
    SELECT a.id,a.title,a.payload->>'before' AS before_text,a.payload->>'after' AS after_text,a.created_at FROM ai_agent_actions a JOIN ai_agent_sessions s ON s.id=a.session_id
    WHERE s.user_id=$1 AND s.novel_id=$2 AND a.status='completed' AND a.kind IN ('apply_rewrite','apply_chapter_edit')
    AND jsonb_typeof(a.payload->'before')='string' AND jsonb_typeof(a.payload->'after')='string'
    AND NOT EXISTS(SELECT 1 FROM ai_writing_edit_samples e WHERE e.user_id=$1 AND e.novel_id=$2 AND e.before_text=a.payload->>'before' AND e.after_text=a.payload->>'after')
    ) history ORDER BY created_at DESC,id LIMIT 7 OFFSET $3`, [userId, session.novel_id, offset])
  return { edits: rows.slice(0, 6).map(row => ({ id: row.id, title: row.title, revision: digest([row.before_text, row.after_text]),
    before: row.before_text.slice(0, 2500), after: row.after_text.slice(0, 2500), truncated: Math.max(row.before_text.length, row.after_text.length) > 2500 })), hasMore: rows.length > 6 }
}
export function studioSnapshot(cards: StudioCard[]): StudioSnapshot {
  const chosen: StudioCard[] = [], omitted: string[] = []
  let size = 0
  for (const original of cards.filter(c => c.status === 'active' && c.kind !== 'reading').sort((a,b) => Number(a.scope === 'personal') - Number(b.scope === 'personal') || a.position - b.position || a.id.localeCompare(b.id))) {
    if (original.stale) { omitted.push(original.title + '（来源已变化）'); continue }
    // Scene prose is read on demand. Plans are not prior story facts.
    const card = original.kind === 'scene' ? { ...original, values: { ...original.values, prose: '' } } : original
    const length = JSON.stringify(card).length
    if (size + length > 24000) { omitted.push(card.title + '（超出本轮资料容量）'); continue }
    size += length; chosen.push(card)
  }
  return { cards: chosen, omitted }
}
export async function readWritingStudio(db: DbClient, userId: string, sessionId: string) {
  const session = await sessionFor(db, userId, sessionId)
  const rows = await all<Row>(db, `SELECT id,card FROM ai_writing_cards WHERE user_id=$1 AND ${scopeSql} AND status<>'archived' ORDER BY created_at,id`, [userId, session.novel_id, sessionId])
  const cards: StudioCard[] = []
  for (const row of rows) cards.push({ ...row.card, stale: !(await evidenceCurrent(db, session, row.card)) })
  cards.sort((a,b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return { cards, contextOmitted: studioSnapshot(cards).omitted }
}
async function persist(db: DbClient, session: Session, card: StudioCard, operationId?: string) {
  const saved = { ...card }; delete saved.stale
  await db.query(`INSERT INTO ai_writing_cards(id,user_id,novel_id,session_id,kind,scope,status,revision,card,operation_id,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
    ON CONFLICT(id) DO UPDATE SET scope=EXCLUDED.scope,novel_id=EXCLUDED.novel_id,session_id=EXCLUDED.session_id,status=EXCLUDED.status,revision=EXCLUDED.revision,card=EXCLUDED.card,updated_at=EXCLUDED.updated_at`,
  [saved.id, session.user_id, saved.scope === 'personal' ? null : session.novel_id, saved.scope === 'session' ? session.id : null,
    saved.kind, saved.scope, saved.status, saved.revision, JSON.stringify(saved), operationId || null, saved.createdAt, saved.updatedAt])
  await db.query('INSERT INTO ai_writing_card_versions(card_id,revision,card,created_at) VALUES($1,$2,$3::jsonb,$4)', [saved.id, saved.revision, JSON.stringify(saved), saved.updatedAt])
  return saved
}
export async function saveWritingCard(db: Db, userId: string, sessionId: string, raw: unknown, proposal?: { taskId: string; operationId: string }) {
  const body = object(raw), input = parseStudioCard(body.card)
  const cardId = body.id === undefined ? '' : text(body.id, 180, true)
  const replaces = body.replaces ? { id: text(object(body.replaces).id, 180, true), revision: revision(object(body.replaces).revision) } : undefined
  if (proposal && cardId) return invalid('助手只能保存待采纳建议，不能直接改写已保存的卡片')
  if (!proposal && replaces) return invalid('手动编辑不接受替换提议')
  return withTx(db, async query => {
    const scoped = { query }, session = await sessionFor(scoped, userId, sessionId, true)
    await writable(scoped, session, proposal)
    if (proposal) {
      const previous = await first<Row>(scoped, 'SELECT id,card FROM ai_writing_cards WHERE user_id=$1 AND operation_id=$2', [userId, proposal.operationId])
      if (previous) {
        if (JSON.stringify(parseStudioCard(previous.card)) !== JSON.stringify(input) || JSON.stringify(previous.card.replaces) !== JSON.stringify(replaces)) conflict('同一建议请求不能更换内容')
        return previous.card
      }
    }
    const old = cardId ? await cardFor(scoped, session, cardId) : undefined
    if (old) {
      if (old.status === 'archived' || old.revision !== revision(body.expectedRevision)) conflict('内容已变化，请保留编辑并重新核对')
      if (old.kind !== input.kind) return invalid('不能更换卡片类别')
      if (old.locked) conflict('请先解锁场景，再编辑内容')
    }
    if (replaces) {
      const target = await cardFor(scoped, session, replaces.id)
      if (target.status !== 'active' || target.revision !== replaces.revision || target.kind !== input.kind || target.scope !== input.scope || target.locked) conflict('原卡片已变化、锁定或不属于同一类别，请重新读取')
    }
    const evidenceCard = old ? { ...input, id: old.id } : input
    if (!(await evidenceCurrent(scoped, session, evidenceCard))) conflict('引文或来源版本已变化，请重新查阅后保存')
    if (proposal && ['voice', 'knowledge', 'reading'].includes(input.kind) && !input.evidence.length) return invalid('这项建议必须附可核对的原文引句')
    if (input.kind === 'reading' && !input.evidence.some(e => e.kind === 'draft' || e.kind === 'scene' || e.kind === 'chapter')) return invalid('模拟试读须关联具体正文')
    if (proposal && input.kind === 'preference' && new Set(input.evidence.filter(e => e.kind === 'edit' && e.beforeQuote && e.beforeQuote !== e.quote).map(e => e.revision)).size < 2)
      return invalid('学习长期偏好至少需要两次独立的已采纳改动，以及修改前后的引句')
    if (!old) {
      const count = await first<{ count: number }>(scoped, `SELECT COUNT(*)::int AS count FROM ai_writing_cards WHERE user_id=$1 AND ${scopeSql} AND status<>'archived'`, [userId, session.novel_id, sessionId])
      if (Number(count?.count) >= 120) return invalid('本书与个人资料合计最多保留 120 项，请先移除不再使用的内容')
    }
    const now = Date.now()
    return persist(scoped, session, { ...input, id: old?.id || newId('writingcard'), revision: (old?.revision || 0) + 1,
      status: old?.status || (proposal ? 'proposed' : 'active'), locked: false, origin: old?.origin || (proposal ? 'assistant' : 'author'),
      ...(old?.replaces || replaces ? { replaces: old?.replaces || replaces } : {}), createdAt: old?.createdAt || now, updatedAt: now }, proposal?.operationId)
  })
}
export async function changeWritingCard(db: Db, userId: string, sessionId: string, id: string, raw: unknown) {
  const body = object(raw), expected = revision(body.expectedRevision)
  if (!['accept', 'archive', 'lock', 'unlock', 'restore'].includes(String(body.operation))) return invalid('操作无效')
  return withTx(db, async query => {
    const scoped = { query }, session = await sessionFor(scoped, userId, sessionId, true)
    await writable(scoped, session)
    const current = await cardFor(scoped, session, id)
    if (current.revision !== expected || current.status === 'archived') conflict('内容已变化，请刷新后重试')
    let card = { ...current, revision: current.revision + 1, updatedAt: Date.now() }
    if (body.operation === 'accept') {
      if (current.status !== 'proposed') return invalid('这项内容不是待采纳建议')
      if (!(await evidenceCurrent(scoped, session, current))) conflict('建议依据已变化，请重新查阅后整理')
      if (current.replaces) {
        const target = await cardFor(scoped, session, current.replaces.id)
        if (target.status !== 'active' || target.locked || target.revision !== current.replaces.revision) conflict('原卡片已变化或已锁定，请重新整理建议')
        if (target.kind !== current.kind || target.scope !== current.scope) conflict('建议范围与原卡片不同，请恢复原范围或另存新项')
        await persist(scoped, session, { ...current, status: 'archived', revision: card.revision, updatedAt: card.updatedAt })
        card = { ...current, id: target.id, revision: target.revision + 1, status: 'active', createdAt: target.createdAt, updatedAt: card.updatedAt }
        delete card.replaces
      } else card.status = 'active'
    } else if (body.operation === 'archive') {
      if (current.locked) conflict('请先解锁，再移除场景')
      card.status = 'archived'
    } else if (body.operation === 'lock' || body.operation === 'unlock') {
      if (current.kind !== 'scene' || current.status !== 'active') return invalid('只有已保存的场景可以锁定')
      card.locked = body.operation === 'lock'
    } else {
      if (current.locked) conflict('请先解锁，再恢复场景版本')
      const previous = await first<{ card: StudioCard }>(scoped, 'SELECT card FROM ai_writing_card_versions WHERE card_id=$1 AND revision=$2', [id, revision(body.version)])
      if (!previous || previous.card.status === 'archived') return invalid('所选历史版本不可恢复')
      if (!(await evidenceCurrent(scoped, session, previous.card))) conflict('历史版本的依据已变化，请复制内容后重新核对')
      card = { ...card, title: previous.card.title, values: previous.card.values, evidence: previous.card.evidence, position: previous.card.position }
    }
    return persist(scoped, session, card)
  })
}
export async function writingCardVersions(db: DbClient, userId: string, sessionId: string, id: string) {
  await cardFor(db, await sessionFor(db, userId, sessionId), id)
  return { versions: await all(db, 'SELECT revision,card,created_at AS "createdAt" FROM ai_writing_card_versions WHERE card_id=$1 ORDER BY revision DESC LIMIT 20', [id]) }
}

/** Deterministic assembly: no generation, no implicit rewriting, no publication. */
export async function assembleWritingScenes(db: Db, userId: string, sessionId: string, raw: unknown) {
  const body = object(raw), title = text(body.title, 160, true)
  if (!Array.isArray(body.scenes) || !body.scenes.length || body.scenes.length > 30) return invalid('请选择 1 至 30 个场景')
  const selections = body.scenes.map(v => ({ id: text(object(v).id, 180, true), revision: revision(object(v).revision) }))
  if (new Set(selections.map(s => s.id)).size !== selections.length) return invalid('场景不能重复选择')
  const fingerprint = digest({ title, selections })
  return withTx(db, async query => {
    const scoped = { query }, session = await sessionFor(scoped, userId, sessionId, true)
    await writable(scoped, session)
    const previous = await first<{ draftId: string; taskId: string }>(scoped, 'SELECT a.draft_id AS "draftId",a.task_id AS "taskId" FROM ai_writing_assemblies a JOIN ai_generations g ON g.id=a.draft_id WHERE a.session_id=$1 AND a.fingerprint=$2 AND g.deleted_at=0', [sessionId, fingerprint])
    if (previous) return previous
    const cards: StudioCard[] = []
    for (const selected of selections) {
      const card = await cardFor(scoped, session, selected.id)
      if (card.kind !== 'scene' || card.status !== 'active' || card.revision !== selected.revision) conflict('场景已变化，请重新预览合成内容')
      if (!card.values.prose?.trim()) return invalid('所选场景尚无正文，请先完成写作')
      cards.push(card)
    }
    const content = cards.map(c => c.values.prose).join('\n\n')
    if (content.length > 80000) return invalid('本章内容过长，请分章合成')
    const task = await createAiTask(scoped, { userId, novelId: session.novel_id, kind: 'write_chapter', total: 1, params: JSON.stringify({ sessionId, sceneAssembly: selections }) })
    const draft = await saveGeneration(scoped, { novelId: session.novel_id, chapterId: '', kind: 'write_chapter', model: '', prompt: '', status: 'draft', createdBy: userId,
      paramsJson: JSON.stringify({ taskId: task.id, draftTitle: title, agentSessionId: sessionId, agentAfterChapterId: session.after_chapter_id, sceneAssembly: cards }), result: content })
    await updateAiTask(scoped, task.id, { status: 'completed', current: 1, total: 1, step: '场景已合成草稿', result: draft.id }, { publish: false })
    await query('INSERT INTO ai_agent_artifacts(task_id,session_id,created_at) VALUES($1,$2,$3)', [task.id, sessionId, Date.now()])
    await query('INSERT INTO ai_writing_assemblies(session_id,fingerprint,draft_id,task_id) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,fingerprint) DO UPDATE SET draft_id=EXCLUDED.draft_id,task_id=EXCLUDED.task_id', [sessionId, fingerprint, draft.id, task.id])
    await query("INSERT INTO ai_agent_events(session_id,role,content,metadata,created_at) VALUES($1,'activity',$2,$3::jsonb,$4)", [sessionId, `已将 ${cards.length} 场戏合成为《${title}》草稿，可在产出与采纳中查看。`, JSON.stringify({ artifactTaskId: task.id }), Date.now()])
    return { draftId: draft.id, taskId: task.id }
  })
}
