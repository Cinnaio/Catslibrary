import type { Db, DbClient } from '../db/pool'
import { withTx } from '../db/query'
import { applyContentRatingChange, CONTENT_RATING_RULE_VERSION } from './content-rating-governance'
import { evaluateContentRatingRules, loadContentRatingRuleSet } from './content-rating-rules'
import { newId } from './auth'

interface UnratedNovelRow {
  id: string
  title: string
  description: string
  categories: string
}

interface RatingMatch {
  id: string
  title: string
  reason: string[]
  evidence: Array<{ type: string; field?: string; value?: string }>
}

export interface ContentRatingPrefillResult {
  scanned: number
  matched: number
  applied: number
  byTag: number
  byText: number
  ids: string[]
  unknown: number
  sample: RatingMatch[]
  operationId?: string
}

function parseCategories(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export interface ContentRatingPrefillOptions {
  dryRun?: boolean
  operationId?: string
  actorUserId?: string
}

/**
 * Only unknown rows can be changed. The write path locks them until commit, so a
 * concurrent manual rating cannot be overwritten by a prefill in progress.
 * This runs before the API starts listening as well as through the admin action.
 */
export async function prefillUnknownContentRatings(db: Db, options: ContentRatingPrefillOptions | boolean = {}): Promise<ContentRatingPrefillResult> {
  const normalized = typeof options === 'boolean' ? { dryRun: options } : options
  const dryRun = normalized.dryRun === true
  const operationId = normalized.operationId?.trim() || newId('rating-prefill')
  const actorUserId = normalized.actorUserId?.trim() || 'system'

  const execute = async (query: DbClient['query']): Promise<ContentRatingPrefillResult> => {
    const ruleSet = await loadContentRatingRuleSet(query)
    const { rows } = await query<UnratedNovelRow>(
      `SELECT id, title, description, categories FROM novels WHERE content_rating = 'unknown'${dryRun ? '' : ' FOR UPDATE'}`,
    )
    const matches: RatingMatch[] = []
    const ids: string[] = []
    let byTag = 0
    let byText = 0

    for (const row of rows) {
      const categories = parseCategories(row.categories)
      const decision = evaluateContentRatingRules({ title: row.title, description: row.description, categories }, ruleSet)
      if (!decision.matched) continue
      const dynamicCategory = decision.dynamicMatches.some((rule) => rule.kind === 'category')
      const dynamicPhrase = decision.dynamicMatches.some((rule) => rule.kind === 'phrase')
      const tag = decision.staticTagMatched || dynamicCategory
      const text = decision.staticTextMatched || dynamicPhrase
      const reason = [tag ? 'tag' : '', text ? 'text' : '', ...decision.dynamicMatches.map((rule) => `rule:${rule.id}`)].filter(Boolean)
      const evidence = decision.evidence
      matches.push({ id: row.id, title: row.title, reason, evidence })
      if (tag) byTag++
      if (text) byText++
      if (!dryRun) {
        // Do not change novels.updated_at: rating is governance metadata, not a new novel update.
        const result = await applyContentRatingChange(query, {
          novelId: row.id,
          rating: 'restricted',
          source: 'prefill',
          actorUserId,
          reason: `规则预填：命中${tag ? '成人标签' : ''}${tag && text ? '与' : ''}${text ? '限制级文本特征' : ''}`,
          evidence,
          ruleVersion: decision.ruleVersion || CONTENT_RATING_RULE_VERSION,
          operationId,
        })
        if (result.changed) ids.push(row.id)
      }
    }

    const remaining = await query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM novels WHERE content_rating = 'unknown'`)
    return {
      scanned: rows.length,
      matched: matches.length,
      applied: ids.length,
      byTag,
      byText,
      ids,
      unknown: Number(remaining.rows[0]?.count ?? 0),
      sample: matches.slice(0, 50),
      ...(dryRun ? {} : { operationId }),
    }
  }

  return dryRun ? execute(db.query.bind(db)) : withTx(db, execute)
}

export interface UndoContentRatingPrefillOptions {
  ids?: string[]
  operationId?: string
  actorUserId?: string
}

/** 只回滚仍保持 prefill 来源的记录，人工确认过的结果不会被自动回滚覆盖。 */
export async function undoPrefilledContentRatings(
  db: Db,
  options: UndoContentRatingPrefillOptions,
): Promise<{ restored: number; skipped: number; operationId: string }> {
  const ids = Array.from(new Set((options.ids || []).map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 5000)
  const requestedOperationId = String(options.operationId || '').trim()
  const operationId = newId('rating-undo')
  const actorUserId = String(options.actorUserId || 'system').trim() || 'system'

  return withTx(db, async (query) => {
    const conditions: string[] = ["content_rating = 'restricted'", "content_rating_source = 'prefill'", "content_rating_operation_id <> ''"]
    const params: unknown[] = []
    if (requestedOperationId) {
      params.push(requestedOperationId)
      conditions.push(`content_rating_operation_id = $${params.length}`)
    } else if (ids.length) {
      params.push(...ids)
      conditions.push(`id IN (${ids.map((_, index) => `$${index + 1}`).join(', ')})`)
    } else {
      throw new Error('ids or operationId is required')
    }

    const rows = await query<
      UnratedNovelRow & {
        content_rating_revision: number
        content_rating_evidence: string
        content_rating_rule_version: string
        content_rating_operation_id: string
      }
    >(
      `SELECT id, title, description, categories, content_rating_revision, content_rating_evidence,
              content_rating_rule_version, content_rating_operation_id
         FROM novels WHERE ${conditions.join(' AND ')} FOR UPDATE`,
      params,
    )
    for (const row of rows.rows) {
      await applyContentRatingChange(query, {
        novelId: row.id,
        rating: 'unknown',
        source: 'system',
        actorUserId,
        reason: '撤销自动分级预填',
        evidence: [{ type: 'rollback', value: row.content_rating_operation_id }],
        ruleVersion: row.content_rating_rule_version || CONTENT_RATING_RULE_VERSION,
        operationId,
        expectedRevision: Number(row.content_rating_revision) || 0,
      })
    }
    return {
      restored: rows.rows.length,
      skipped: Math.max(0, (requestedOperationId ? 0 : ids.length) - rows.rows.length),
      operationId,
    }
  })
}
