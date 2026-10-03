import { isRestrictedCategoryTag } from '@shared/restricted-categories'
import { matchesRestrictedPattern } from '@shared/restricted-patterns'
import type { ContentRating } from '@shared/types'
import type { DbClient } from '../db/pool'
import { newId } from './auth'

/** 当前规则版本写入分级记录，规则调整时递增，便于筛出需要重新复核的作品。 */
export const CONTENT_RATING_RULE_VERSION = 'restricted-rules-v1'

export const CONTENT_RATING_SOURCES = ['manual', 'ai_task', 'prefill', 'source_import', 'migration', 'system', 'legacy'] as const
export type ContentRatingSource = (typeof CONTENT_RATING_SOURCES)[number]

export interface ContentRatingEvidenceItem {
  type: string
  field?: string
  value?: string
  rule?: string
}

export interface ContentRatingState {
  id: string
  content_rating: string
  content_rating_revision: number
  content_rating_source: string
  content_rating_reason: string
  content_rating_evidence: string
  content_rating_rule_version: string
  content_rating_updated_by: string
  content_rating_updated_at: number
  content_rating_operation_id: string
}

export interface ContentRatingChangeInput {
  novelId: string
  rating: ContentRating
  source: ContentRatingSource
  actorUserId: string
  reason?: string
  evidence?: unknown
  ruleVersion?: string
  operationId?: string
  expectedRevision?: number
  now?: number
}

export interface ContentRatingChangeResult {
  changed: boolean
  fromRating: ContentRating
  toRating: ContentRating
  revision: number
  source: ContentRatingSource
  reason: string
  evidence: ContentRatingEvidenceItem[]
  ruleVersion: string
  updatedBy: string
  updatedAt: number
  operationId: string
}

export class ContentRatingConflictError extends Error {
  readonly currentRevision: number
  readonly currentRating: ContentRating

  constructor(currentRevision: number, currentRating: ContentRating) {
    super('作品分级已被其他管理员修改，请刷新后重新确认')
    this.name = 'ContentRatingConflictError'
    this.currentRevision = currentRevision
    this.currentRating = currentRating
  }
}

export function isContentRatingSource(value: unknown): value is ContentRatingSource {
  return typeof value === 'string' && (CONTENT_RATING_SOURCES as readonly string[]).includes(value)
}

export function normalizeContentRatingSource(value: unknown): ContentRatingSource {
  return isContentRatingSource(value) ? value : 'system'
}

export function parseContentRatingEvidence(value: unknown): ContentRatingEvidenceItem[] {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = []
    }
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .slice(0, 20)
    .map((item): ContentRatingEvidenceItem | null => {
      if (typeof item === 'string') return { type: 'note', value: item.slice(0, 240) }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const source = item as Record<string, unknown>
      const type = String(source.type || 'note')
        .trim()
        .slice(0, 60)
      if (!type) return null
      const result: ContentRatingEvidenceItem = { type }
      for (const key of ['field', 'value', 'rule'] as const) {
        const text = String(source[key] || '').trim()
        if (text) result[key] = text.slice(0, 240)
      }
      return result
    })
    .filter((item): item is ContentRatingEvidenceItem => !!item)
}

export function serializeContentRatingEvidence(value: unknown): string {
  const evidence = parseContentRatingEvidence(value)
  const serialized = JSON.stringify(evidence)
  return serialized.length <= 4000 ? serialized : JSON.stringify(evidence.slice(0, 8))
}

/** 规则初判的可解释证据；不保存整段简介，只保存命中的字段和分类。 */
export function evidenceForRatingRules(input: { title?: string; description?: string; categories?: readonly string[] }): ContentRatingEvidenceItem[] {
  const evidence: ContentRatingEvidenceItem[] = []
  for (const category of input.categories || []) {
    if (isRestrictedCategoryTag(category)) evidence.push({ type: 'category', value: String(category).slice(0, 240) })
  }
  if (matchesRestrictedPattern(String(input.title || ''))) evidence.push({ type: 'text', field: 'title' })
  if (matchesRestrictedPattern(String(input.description || ''))) evidence.push({ type: 'text', field: 'description' })
  return evidence.slice(0, 20)
}

function boundedText(value: unknown, max: number): string {
  return String(value || '')
    .trim()
    .slice(0, max)
}

function boundedRevision(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const revision = Number(value)
  return Number.isInteger(revision) && revision >= 0 ? revision : undefined
}

/**
 * 在调用方已经开启的事务中修改作品分级并写入审计。
 * 该函数自己加行锁，因此创建、后台编辑、自动预填和源站同步都能共用同一条并发语义。
 */
export async function applyContentRatingChange(query: DbClient['query'], input: ContentRatingChangeInput): Promise<ContentRatingChangeResult> {
  const novelId = boundedText(input.novelId, 160)
  const currentResult = await query<ContentRatingState>(
    `SELECT id, content_rating, content_rating_revision, content_rating_source,
            content_rating_reason, content_rating_evidence, content_rating_rule_version,
            content_rating_updated_by, content_rating_updated_at, content_rating_operation_id
       FROM novels WHERE id = $1 FOR UPDATE`,
    [novelId],
  )
  const current = currentResult.rows[0]
  if (!current) throw new Error('Novel not found')

  const currentRating = toContentRating(current.content_rating)
  const currentRevision = Number(current.content_rating_revision) || 0
  const expectedRevision = boundedRevision(input.expectedRevision)
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new ContentRatingConflictError(currentRevision, currentRating)
  }

  const source = normalizeContentRatingSource(input.source)
  const reason = boundedText(input.reason, 500)
  const evidence = serializeContentRatingEvidence(input.evidence)
  const ruleVersion = boundedText(input.ruleVersion, 120)
  const updatedBy = boundedText(input.actorUserId, 160)
  const operationId = boundedText(input.operationId, 160)
  const nextRating = toContentRating(input.rating)
  const same =
    currentRating === nextRating &&
    String(current.content_rating_source || '') === source &&
    String(current.content_rating_reason || '') === reason &&
    String(current.content_rating_evidence || '[]') === evidence &&
    String(current.content_rating_rule_version || '') === ruleVersion &&
    String(current.content_rating_updated_by || '') === updatedBy &&
    String(current.content_rating_operation_id || '') === operationId

  if (same) {
    return {
      changed: false,
      fromRating: currentRating,
      toRating: nextRating,
      revision: currentRevision,
      source,
      reason,
      evidence: parseContentRatingEvidence(current.content_rating_evidence),
      ruleVersion: String(current.content_rating_rule_version || ''),
      updatedBy: String(current.content_rating_updated_by || ''),
      updatedAt: Number(current.content_rating_updated_at) || 0,
      operationId: String(current.content_rating_operation_id || ''),
    }
  }

  const now = Number(input.now) || Date.now()
  const revision = currentRevision + 1
  await query(
    `UPDATE novels
        SET content_rating = $1,
            content_rating_revision = $2,
            content_rating_source = $3,
            content_rating_reason = $4,
            content_rating_evidence = $5,
            content_rating_rule_version = $6,
            content_rating_updated_by = $7,
            content_rating_updated_at = $8,
            content_rating_operation_id = $9
      WHERE id = $10`,
    [nextRating, revision, source, reason, evidence, ruleVersion, updatedBy, now, operationId, novelId],
  )
  await query(
    `INSERT INTO novel_content_rating_audit
      (id, novel_id, from_rating, to_rating, source, reason, evidence, rule_version, operation_id, actor_user_id, expected_revision, resulting_revision, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [newId('ratingaudit'), novelId, currentRating, nextRating, source, reason, evidence, ruleVersion, operationId, updatedBy, currentRevision, revision, now],
  )

  return {
    changed: true,
    fromRating: currentRating,
    toRating: nextRating,
    revision,
    source,
    reason,
    evidence: parseContentRatingEvidence(evidence),
    ruleVersion,
    updatedBy,
    updatedAt: now,
    operationId,
  }
}

export function toContentRating(value: unknown): ContentRating {
  return value === 'general' || value === 'restricted' ? value : 'unknown'
}
