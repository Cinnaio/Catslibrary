import { isRestrictedCategoryTag, normalizeCategoryTag } from '@shared/restricted-categories'
import type { Db, DbClient } from '../db/pool'
import { all, first } from '../db/query'
import { newId } from './auth'
import {
  applyContentRatingChange,
  CONTENT_RATING_RULE_VERSION,
  parseContentRatingEvidence,
  serializeContentRatingEvidence,
  type ContentRatingEvidenceItem,
} from './content-rating-governance'
import {
  buildContentRatingRuleSet,
  evaluateSingleDynamicRule,
  loadContentRatingRuleSet,
  loadCurrentContentRatingRuleVersion,
  type DynamicContentRatingRule,
} from './content-rating-rules'

export const CONTENT_RATING_RULE_CANDIDATE_KINDS = ['category', 'phrase'] as const
export type ContentRatingRuleCandidateKind = (typeof CONTENT_RATING_RULE_CANDIDATE_KINDS)[number]

export const CONTENT_RATING_RULE_CANDIDATE_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ContentRatingRuleCandidateStatus = (typeof CONTENT_RATING_RULE_CANDIDATE_STATUSES)[number]

export interface ContentRatingRuleCandidateListOptions {
  status?: string
  kind?: string
  search?: string
  limit: number
  offset: number
}

export interface CreateContentRatingRuleCandidateInput {
  novelId: string
  kind: ContentRatingRuleCandidateKind
  value: string
  reason: string
  actorUserId: string
}

export interface ContentRatingRuleCandidatePreviewOptions {
  limit: number
  offset: number
}

export interface ReviewContentRatingRuleCandidateInput {
  candidateId: string
  decision: 'approve' | 'reject'
  expectedRevision: number
  reason: string
  actorUserId: string
}

interface CandidateRow {
  id: string
  kind: string
  value: string
  normalized_value: string
  target_rating: string
  status: string
  created_by: string
  creator_username?: string
  creator_display_name?: string
  created_at: number
  reviewed_by: string
  reviewer_username?: string
  reviewer_display_name?: string
  reviewed_at: number
  review_reason: string
  updated_at: number
  review_revision: number
  rule_version: string
  example_count: number
  latest_example_novel_id?: string
  latest_example_novel_title?: string
  latest_example_novel_author?: string
  latest_example_revision?: number
  latest_example_operation_id?: string
  latest_example_reason?: string
  latest_example_evidence?: string
  latest_example_created_by?: string
  latest_example_creator_username?: string
  latest_example_creator_display_name?: string
  latest_example_created_at?: number
}

interface SourceNovelRow {
  id: string
  title: string
  author: string
  content_rating: string
  content_rating_source: string
  content_rating_revision: number
  content_rating_operation_id: string
  content_rating_reason: string
  content_rating_evidence: string
}

export class ContentRatingRuleCandidateValidationError extends Error {
  readonly code = 'rule_candidate_invalid'

  constructor(message: string) {
    super(message)
    this.name = 'ContentRatingRuleCandidateValidationError'
  }
}

export class ContentRatingRuleCandidateSourceError extends Error {
  readonly code = 'rule_candidate_source_invalid'

  constructor(message: string) {
    super(message)
    this.name = 'ContentRatingRuleCandidateSourceError'
  }
}

export class ContentRatingRuleCandidateConflictError extends Error {
  readonly code: 'rule_candidate_exists' | 'rule_candidate_not_pending' | 'rule_candidate_conflict'

  constructor(code: 'rule_candidate_exists' | 'rule_candidate_not_pending' | 'rule_candidate_conflict', message: string) {
    super(message)
    this.name = 'ContentRatingRuleCandidateConflictError'
    this.code = code
  }
}

export class ContentRatingRuleCandidateNotFoundError extends Error {
  readonly code = 'rule_candidate_not_found'

  constructor(message = '规则候选不存在') {
    super(message)
    this.name = 'ContentRatingRuleCandidateNotFoundError'
  }
}

export function isContentRatingRuleCandidateKind(value: unknown): value is ContentRatingRuleCandidateKind {
  return typeof value === 'string' && (CONTENT_RATING_RULE_CANDIDATE_KINDS as readonly string[]).includes(value)
}

export function isContentRatingRuleCandidateStatus(value: unknown): value is ContentRatingRuleCandidateStatus {
  return typeof value === 'string' && (CONTENT_RATING_RULE_CANDIDATE_STATUSES as readonly string[]).includes(value)
}

function cleanText(value: unknown, max: number): string {
  return String(value || '')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .trim()
    .slice(0, max)
}

export function normalizeContentRatingRuleCandidateValue(kind: ContentRatingRuleCandidateKind, value: unknown): string {
  const cleaned = cleanText(value, 160)
  if (kind === 'category') return normalizeCategoryTag(cleaned)
  return cleaned.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
}

function validateCandidateInput(input: CreateContentRatingRuleCandidateInput): {
  novelId: string
  kind: ContentRatingRuleCandidateKind
  value: string
  normalizedValue: string
  reason: string
  actorUserId: string
} {
  const novelId = cleanText(input.novelId, 160)
  const kind = input.kind
  const value = cleanText(input.value, 160)
  const normalizedValue = normalizeContentRatingRuleCandidateValue(kind, value)
  const reason = cleanText(input.reason, 500)
  const actorUserId = cleanText(input.actorUserId, 160)

  if (!novelId) throw new ContentRatingRuleCandidateValidationError('novelId is required')
  if (!isContentRatingRuleCandidateKind(kind)) throw new ContentRatingRuleCandidateValidationError('kind must be category or phrase')
  if (!normalizedValue) throw new ContentRatingRuleCandidateValidationError('候选值不能为空')
  if (kind === 'phrase' && normalizedValue.length < 2) {
    throw new ContentRatingRuleCandidateValidationError('文本短语至少需要 2 个字符，避免生成过宽规则')
  }
  if (!reason) throw new ContentRatingRuleCandidateValidationError('沉淀规则候选必须填写理由')
  if (!actorUserId) throw new ContentRatingRuleCandidateValidationError('actorUserId is required')
  if (kind === 'category' && isRestrictedCategoryTag(normalizedValue)) {
    throw new ContentRatingRuleCandidateConflictError('rule_candidate_exists', '该分类标签已经在现行限制级规则中')
  }

  return { novelId, kind, value, normalizedValue, reason, actorUserId }
}

const candidateSelect = `
  SELECT c.id, c.kind, c.value, c.normalized_value, c.target_rating, c.status,
         c.created_by, creator.username AS creator_username, creator.display_name AS creator_display_name,
         c.created_at, c.reviewed_by, reviewer.username AS reviewer_username,
         reviewer.display_name AS reviewer_display_name, c.reviewed_at, c.review_reason, c.updated_at,
         c.review_revision, c.rule_version,
         COUNT(e.id)::int AS example_count,
         (ARRAY_AGG(e.novel_id ORDER BY e.created_at DESC))[1] AS latest_example_novel_id,
         (ARRAY_AGG(n.title ORDER BY e.created_at DESC))[1] AS latest_example_novel_title,
         (ARRAY_AGG(n.author ORDER BY e.created_at DESC))[1] AS latest_example_novel_author,
         (ARRAY_AGG(e.novel_rating_revision ORDER BY e.created_at DESC))[1] AS latest_example_revision,
         (ARRAY_AGG(e.operation_id ORDER BY e.created_at DESC))[1] AS latest_example_operation_id,
         (ARRAY_AGG(e.reason ORDER BY e.created_at DESC))[1] AS latest_example_reason,
         (ARRAY_AGG(e.evidence ORDER BY e.created_at DESC))[1] AS latest_example_evidence,
         (ARRAY_AGG(e.created_by ORDER BY e.created_at DESC))[1] AS latest_example_created_by,
         (ARRAY_AGG(example_creator.username ORDER BY e.created_at DESC))[1] AS latest_example_creator_username,
         (ARRAY_AGG(example_creator.display_name ORDER BY e.created_at DESC))[1] AS latest_example_creator_display_name,
         (ARRAY_AGG(e.created_at ORDER BY e.created_at DESC))[1] AS latest_example_created_at
    FROM content_rating_rule_candidates c
    LEFT JOIN content_rating_rule_candidate_examples e ON e.candidate_id = c.id
    LEFT JOIN novels n ON n.id = e.novel_id
    LEFT JOIN users creator ON creator.id = c.created_by
    LEFT JOIN users reviewer ON reviewer.id = c.reviewed_by
    LEFT JOIN users example_creator ON example_creator.id = e.created_by`

function candidateItem(row: CandidateRow) {
  return {
    id: String(row.id),
    kind: isContentRatingRuleCandidateKind(row.kind) ? row.kind : 'phrase',
    value: String(row.value || ''),
    normalizedValue: String(row.normalized_value || ''),
    targetRating: 'restricted' as const,
    status: isContentRatingRuleCandidateStatus(row.status) ? row.status : 'pending',
    createdBy: String(row.created_by || ''),
    createdByName: String(row.creator_display_name || row.creator_username || row.created_by || '系统'),
    createdAt: Number(row.created_at) || 0,
    reviewedBy: String(row.reviewed_by || ''),
    reviewedByName: String(row.reviewer_display_name || row.reviewer_username || row.reviewed_by || ''),
    reviewedAt: Number(row.reviewed_at) || 0,
    reviewReason: String(row.review_reason || ''),
    updatedAt: Number(row.updated_at) || 0,
    revision: Number(row.review_revision) || 0,
    ruleVersion: String(row.rule_version || ''),
    exampleCount: Number(row.example_count) || 0,
    latestExample: row.latest_example_novel_id
      ? {
          novelId: String(row.latest_example_novel_id),
          novelTitle: String(row.latest_example_novel_title || ''),
          novelAuthor: String(row.latest_example_novel_author || ''),
          revision: Number(row.latest_example_revision) || 0,
          operationId: String(row.latest_example_operation_id || ''),
          reason: String(row.latest_example_reason || ''),
          evidence: parseContentRatingEvidence(row.latest_example_evidence),
          createdBy: String(row.latest_example_created_by || ''),
          createdByName: String(row.latest_example_creator_display_name || row.latest_example_creator_username || row.latest_example_created_by || '系统'),
          createdAt: Number(row.latest_example_created_at) || 0,
        }
      : null,
  }
}

export type ContentRatingRuleCandidateItem = ReturnType<typeof candidateItem>

async function loadCandidate(query: DbClient['query'], id: string): Promise<CandidateRow | undefined> {
  const result = await query<CandidateRow>(
    `${candidateSelect}
     WHERE c.id = $1
     GROUP BY c.id, creator.username, creator.display_name, reviewer.username, reviewer.display_name`,
    [id],
  )
  return result.rows[0]
}

export async function listContentRatingRuleCandidates(
  db: Db,
  options: ContentRatingRuleCandidateListOptions,
): Promise<{
  rows: ContentRatingRuleCandidateItem[]
  total: number
  counts: Record<ContentRatingRuleCandidateStatus, number>
  activeRuleVersion: string
}> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (isContentRatingRuleCandidateStatus(options.status)) {
    params.push(options.status)
    conditions.push(`c.status = $${params.length}`)
  }
  if (isContentRatingRuleCandidateKind(options.kind)) {
    params.push(options.kind)
    conditions.push(`c.kind = $${params.length}`)
  }
  const search = cleanText(options.search, 120).toLowerCase()
  if (search) {
    params.push(`%${search.replace(/[%_]/g, (match) => `\\${match}`)}%`)
    const index = params.length
    conditions.push(`(LOWER(c.value) LIKE $${index} ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM content_rating_rule_candidate_examples se
      LEFT JOIN novels sn ON sn.id = se.novel_id
      WHERE se.candidate_id = c.id
        AND (LOWER(COALESCE(sn.title, '')) LIKE $${index} ESCAPE '\\'
          OR LOWER(COALESCE(se.reason, '')) LIKE $${index} ESCAPE '\\')
    ))`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const grouped = `${candidateSelect}
    ${where}
    GROUP BY c.id, creator.username, creator.display_name, reviewer.username, reviewer.display_name
    ORDER BY c.updated_at DESC, c.value ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  const rows = await all<CandidateRow>(db, grouped, [...params, options.limit, options.offset])
  const total = await first<{ total: number }>(db, `SELECT COUNT(*)::int AS total FROM content_rating_rule_candidates c ${where}`, params)
  const countRows = await all<{ status: string; count: number }>(
    db,
    'SELECT status, COUNT(*)::int AS count FROM content_rating_rule_candidates GROUP BY status',
  )
  const counts: Record<ContentRatingRuleCandidateStatus, number> = { pending: 0, approved: 0, rejected: 0 }
  for (const row of countRows) if (isContentRatingRuleCandidateStatus(row.status)) counts[row.status] = Number(row.count) || 0
  return {
    rows: rows.map(candidateItem),
    total: Number(total?.total) || 0,
    counts,
    activeRuleVersion: await loadCurrentContentRatingRuleVersion(db.query.bind(db)),
  }
}

export async function createContentRatingRuleCandidate(
  query: DbClient['query'],
  input: CreateContentRatingRuleCandidateInput,
): Promise<{ candidate: ReturnType<typeof candidateItem>; created: boolean; exampleAdded: boolean }> {
  const normalized = validateCandidateInput(input)
  const sourceResult = await query<SourceNovelRow>(
    `SELECT id, title, author, content_rating, content_rating_source, content_rating_revision,
            content_rating_operation_id, content_rating_reason, content_rating_evidence
       FROM novels WHERE id = $1 FOR UPDATE`,
    [normalized.novelId],
  )
  const source = sourceResult.rows[0]
  if (!source) throw new ContentRatingRuleCandidateSourceError('来源作品不存在')
  if (source.content_rating !== 'restricted' || source.content_rating_source !== 'manual') {
    throw new ContentRatingRuleCandidateSourceError('只有人工确认的 restricted 作品才能沉淀规则候选')
  }

  const now = Date.now()
  const inserted = await query<{ id: string }>(
    `INSERT INTO content_rating_rule_candidates
       (id, kind, value, normalized_value, target_rating, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'restricted', 'pending', $5, $6, $6)
     ON CONFLICT (kind, normalized_value) DO NOTHING
     RETURNING id`,
    [newId('ratingrule'), normalized.kind, normalized.value, normalized.normalizedValue, normalized.actorUserId, now],
  )
  const created = !!inserted.rows[0]?.id
  const candidateId =
    String(inserted.rows[0]?.id || '') ||
    String(
      (
        await query<{ id: string; status: string }>(
          `SELECT id, status FROM content_rating_rule_candidates
        WHERE kind = $1 AND normalized_value = $2
        FOR UPDATE`,
          [normalized.kind, normalized.normalizedValue],
        )
      ).rows[0]?.id || '',
    )
  if (!candidateId) throw new Error('规则候选创建失败')

  const existing = await query<{ status: string }>('SELECT status FROM content_rating_rule_candidates WHERE id = $1', [candidateId])
  const status = existing.rows[0]?.status
  if (!created && status !== 'pending') {
    throw new ContentRatingRuleCandidateConflictError('rule_candidate_not_pending', '该规则候选已经审核，不再接受新的人工样本')
  }

  const sourceEvidence = parseContentRatingEvidence(source.content_rating_evidence)
  const evidence = serializeContentRatingEvidence([
    ...sourceEvidence,
    { type: 'manual-rule-candidate', field: normalized.kind, value: normalized.normalizedValue },
  ])
  const example = await query<{ id: string }>(
    `INSERT INTO content_rating_rule_candidate_examples
       (id, candidate_id, novel_id, novel_rating_revision, operation_id, reason, evidence, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (candidate_id, novel_id, novel_rating_revision) DO NOTHING
     RETURNING id`,
    [
      newId('ratingruleexample'),
      candidateId,
      source.id,
      Number(source.content_rating_revision) || 0,
      source.content_rating_operation_id || '',
      normalized.reason,
      evidence,
      normalized.actorUserId,
      now,
    ],
  )
  const exampleAdded = !!example.rows[0]?.id
  if (exampleAdded) {
    await query('UPDATE content_rating_rule_candidates SET updated_at = $1, review_revision = review_revision + 1 WHERE id = $2', [now, candidateId])
  }

  const row = await loadCandidate(query, candidateId)
  if (!row) throw new Error('规则候选读取失败')
  return { candidate: candidateItem(row), created, exampleAdded }
}

interface PreviewNovelRow {
  id: string
  title: string
  author: string
  description: string
  categories: string
  content_rating_revision: number
  content_rating_source: string
}

function parseCategories(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function candidateRule(row: CandidateRow): DynamicContentRatingRule {
  return {
    id: String(row.id),
    kind: row.kind === 'category' ? 'category' : 'phrase',
    value: String(row.value || ''),
    normalizedValue: String(row.normalized_value || ''),
  }
}

function previewItem(row: PreviewNovelRow, evidence: ContentRatingEvidenceItem[]) {
  return {
    novelId: String(row.id),
    title: String(row.title || ''),
    author: String(row.author || ''),
    revision: Number(row.content_rating_revision) || 0,
    source: String(row.content_rating_source || 'legacy'),
    matchedFields: Array.from(new Set(evidence.map((item) => item.field).filter((field): field is string => !!field))),
    evidence,
  }
}

export async function previewContentRatingRuleCandidate(
  db: Db,
  candidateId: string,
  options: ContentRatingRuleCandidatePreviewOptions,
): Promise<{
  candidate: ContentRatingRuleCandidateItem
  currentRuleVersion: string
  prospectiveRuleVersion: string
  affectedCount: number
  items: ReturnType<typeof previewItem>[]
}> {
  const row = await loadCandidate(db.query.bind(db), cleanText(candidateId, 160))
  if (!row) throw new ContentRatingRuleCandidateNotFoundError()

  const currentRuleSet = await loadContentRatingRuleSet(db.query.bind(db))
  const rule = candidateRule(row)
  const prospectiveRuleSet = row.status === 'pending' ? buildContentRatingRuleSet([...currentRuleSet.rules, rule]) : currentRuleSet
  const rows = await all<PreviewNovelRow>(
    db,
    `SELECT id, title, author, description, categories, content_rating_revision, content_rating_source
       FROM novels
      WHERE content_rating = 'unknown'
      ORDER BY title ASC, id ASC`,
  )
  const matches =
    row.status === 'rejected'
      ? []
      : rows.flatMap((novel) => {
          const result = evaluateSingleDynamicRule({ title: novel.title, description: novel.description, categories: parseCategories(novel.categories) }, rule)
          return result.matched ? [previewItem(novel, result.evidence)] : []
        })
  return {
    candidate: candidateItem(row),
    currentRuleVersion: await loadCurrentContentRatingRuleVersion(db.query.bind(db)),
    prospectiveRuleVersion: prospectiveRuleSet.version,
    affectedCount: matches.length,
    items: matches.slice(options.offset, options.offset + options.limit),
  }
}

type ReviewNovelRow = PreviewNovelRow

export async function reviewContentRatingRuleCandidate(
  query: DbClient['query'],
  input: ReviewContentRatingRuleCandidateInput,
): Promise<{
  candidate: ContentRatingRuleCandidateItem
  decision: 'approve' | 'reject'
  ruleVersion: string
  matchedCount: number
  appliedCount: number
  operationId: string
}> {
  const candidateId = cleanText(input.candidateId, 160)
  const reason = cleanText(input.reason, 500)
  const actorUserId = cleanText(input.actorUserId, 160)
  if (!candidateId) throw new ContentRatingRuleCandidateValidationError('candidateId is required')
  if (input.decision !== 'approve' && input.decision !== 'reject') {
    throw new ContentRatingRuleCandidateValidationError('decision must be approve or reject')
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ContentRatingRuleCandidateValidationError('expectedRevision is required')
  }
  if (!reason) throw new ContentRatingRuleCandidateValidationError('审核决定必须填写理由')
  if (!actorUserId) throw new ContentRatingRuleCandidateValidationError('actorUserId is required')

  const state = await query<{ rule_version: string }>(`SELECT rule_version FROM content_rating_rule_state WHERE id = 'global' FOR UPDATE`)
  const candidateResult = await query<CandidateRow>(
    `SELECT id, kind, value, normalized_value, target_rating, status, created_by, created_at,
            reviewed_by, reviewed_at, review_reason, updated_at, review_revision, rule_version
       FROM content_rating_rule_candidates WHERE id = $1 FOR UPDATE`,
    [candidateId],
  )
  const current = candidateResult.rows[0]
  if (!current) throw new ContentRatingRuleCandidateNotFoundError()
  if (current.status !== 'pending') {
    throw new ContentRatingRuleCandidateConflictError('rule_candidate_not_pending', '该规则候选已经审核，不能重复处理')
  }
  const currentRevision = Number(current.review_revision) || 0
  if (currentRevision !== input.expectedRevision) {
    throw new ContentRatingRuleCandidateConflictError('rule_candidate_conflict', '规则候选已被其他管理员更新，请刷新后重新审核')
  }

  const now = Date.now()
  const currentRuleVersion = String(state.rows[0]?.rule_version || CONTENT_RATING_RULE_VERSION)
  if (input.decision === 'reject') {
    await query(
      `UPDATE content_rating_rule_candidates
          SET status = 'rejected', reviewed_by = $1, reviewed_at = $2, review_reason = $3,
              rule_version = $4, updated_at = $2, review_revision = review_revision + 1
        WHERE id = $5`,
      [actorUserId, now, reason, currentRuleVersion, candidateId],
    )
    const reviewed = await loadCandidate(query, candidateId)
    if (!reviewed) throw new ContentRatingRuleCandidateNotFoundError()
    return {
      candidate: candidateItem(reviewed),
      decision: 'reject',
      ruleVersion: currentRuleVersion,
      matchedCount: 0,
      appliedCount: 0,
      operationId: '',
    }
  }

  await query(
    `UPDATE content_rating_rule_candidates
        SET status = 'approved', reviewed_by = $1, reviewed_at = $2, review_reason = $3,
            updated_at = $2, review_revision = review_revision + 1
      WHERE id = $4`,
    [actorUserId, now, reason, candidateId],
  )
  const ruleSet = await loadContentRatingRuleSet(query)
  const ruleVersion = ruleSet.version
  await query(`UPDATE content_rating_rule_candidates SET rule_version = $1, updated_at = $2 WHERE id = $3`, [ruleVersion, now, candidateId])
  await query(`UPDATE content_rating_rule_state SET rule_version = $1, updated_by = $2, updated_at = $3 WHERE id = 'global'`, [ruleVersion, actorUserId, now])

  const operationId = newId('rating-rule-apply')
  const approvedRule = candidateRule(current)
  const novels = await query<ReviewNovelRow>(
    `SELECT id, title, author, description, categories, content_rating_revision, content_rating_source
       FROM novels WHERE content_rating = 'unknown' FOR UPDATE`,
  )
  let matchedCount = 0
  let appliedCount = 0
  for (const novel of novels.rows) {
    const decision = evaluateSingleDynamicRule(
      { title: novel.title, description: novel.description, categories: parseCategories(novel.categories) },
      approvedRule,
    )
    if (!decision.matched) continue
    matchedCount++
    const result = await applyContentRatingChange(query, {
      novelId: novel.id,
      rating: 'restricted',
      source: 'prefill',
      actorUserId,
      reason: `规则候选「${String(current.value || '').slice(0, 120)}」审核通过后应用限制级规则`,
      evidence: decision.evidence,
      ruleVersion,
      operationId,
      expectedRevision: Number(novel.content_rating_revision) || 0,
      now,
    })
    if (result.changed) appliedCount++
  }

  const reviewed = await loadCandidate(query, candidateId)
  if (!reviewed) throw new ContentRatingRuleCandidateNotFoundError()
  return {
    candidate: candidateItem(reviewed),
    decision: 'approve',
    ruleVersion,
    matchedCount,
    appliedCount,
    operationId,
  }
}
