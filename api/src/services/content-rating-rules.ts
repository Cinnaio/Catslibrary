import { createHash } from 'node:crypto'
import { hasRestrictedCategoryTag, normalizeCategoryTag } from '@shared/restricted-categories'
import { hasRestrictedText } from '@shared/restricted-patterns'
import type { ContentRating } from '@shared/types'
import type { DbClient } from '../db/pool'
import { CONTENT_RATING_RULE_VERSION, evidenceForRatingRules, type ContentRatingEvidenceItem } from './content-rating-governance'

export interface DynamicContentRatingRule {
  id: string
  kind: 'category' | 'phrase'
  value: string
  normalizedValue: string
}

export interface ContentRatingRuleSet {
  version: string
  rules: DynamicContentRatingRule[]
}

export interface ContentRatingRuleSource {
  title?: string
  description?: string
  categories?: readonly string[]
}

export interface ContentRatingRuleDecision {
  rating: ContentRating
  matched: boolean
  staticTagMatched: boolean
  staticTextMatched: boolean
  dynamicMatches: DynamicContentRatingRule[]
  reasons: string[]
  evidence: ContentRatingEvidenceItem[]
  ruleVersion: string
}

interface DynamicRuleRow {
  id: string
  kind: string
  value: string
  normalized_value: string
}

function normalizePhrase(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function dynamicRuleKey(rule: Pick<DynamicContentRatingRule, 'kind' | 'normalizedValue'>): string {
  return `${rule.kind}:${rule.normalizedValue}`
}

export function buildContentRatingRuleSet(rules: readonly DynamicContentRatingRule[]): ContentRatingRuleSet {
  const normalizedRules = Array.from(new Map(rules.map((rule) => [dynamicRuleKey(rule), rule])).values()).sort((a, b) => {
    const left = dynamicRuleKey(a)
    const right = dynamicRuleKey(b)
    return left < right ? -1 : left > right ? 1 : 0
  })
  if (!normalizedRules.length) return { version: CONTENT_RATING_RULE_VERSION, rules: [] }

  const digest = createHash('sha256')
    .update(JSON.stringify(normalizedRules.map((rule) => ({ id: rule.id, kind: rule.kind, value: rule.value, normalizedValue: rule.normalizedValue }))))
    .digest('hex')
    .slice(0, 16)
  return { version: `restricted-rules-v2-${digest}`, rules: normalizedRules }
}

export async function loadContentRatingRuleSet(query: DbClient['query']): Promise<ContentRatingRuleSet> {
  const result = await query<DynamicRuleRow>(
    `SELECT id, kind, value, normalized_value
       FROM content_rating_rule_candidates
      WHERE status = 'approved'
      ORDER BY kind ASC, normalized_value ASC, id ASC`,
  )
  const rules = result.rows
    .filter((row) => (row.kind === 'category' || row.kind === 'phrase') && String(row.normalized_value || '').trim())
    .map((row) => ({
      id: String(row.id),
      kind: row.kind as DynamicContentRatingRule['kind'],
      value: String(row.value || ''),
      normalizedValue: String(row.normalized_value || ''),
    }))
  return buildContentRatingRuleSet(rules)
}

export async function loadCurrentContentRatingRuleVersion(query: DbClient['query']): Promise<string> {
  const result = await query<{ rule_version: string }>(`SELECT rule_version FROM content_rating_rule_state WHERE id = 'global'`)
  return String(result.rows[0]?.rule_version || CONTENT_RATING_RULE_VERSION)
}

export function matchesDynamicContentRatingRule(source: ContentRatingRuleSource | null | undefined, rule: DynamicContentRatingRule): boolean {
  if (!source) return false
  if (rule.kind === 'category') {
    return (source.categories || []).some((category) => normalizeCategoryTag(category) === rule.normalizedValue)
  }
  const phrase = normalizePhrase(rule.normalizedValue)
  if (!phrase) return false
  return [source.title, source.description].some((value) => normalizePhrase(value).includes(phrase))
}

function evidenceForDynamicRule(source: ContentRatingRuleSource, rule: DynamicContentRatingRule): ContentRatingEvidenceItem[] {
  if (rule.kind === 'category') {
    const matched = (source.categories || []).some((category) => normalizeCategoryTag(category) === rule.normalizedValue)
    return matched ? [{ type: 'rule-candidate', field: 'categories', value: rule.value, rule: rule.id }] : []
  }
  const evidence: ContentRatingEvidenceItem[] = []
  const phrase = normalizePhrase(rule.normalizedValue)
  if (normalizePhrase(source.title).includes(phrase)) evidence.push({ type: 'rule-candidate', field: 'title', value: rule.value, rule: rule.id })
  if (normalizePhrase(source.description).includes(phrase)) {
    evidence.push({ type: 'rule-candidate', field: 'description', value: rule.value, rule: rule.id })
  }
  return evidence
}

export function evaluateContentRatingRules(source: ContentRatingRuleSource | null | undefined, ruleSet: ContentRatingRuleSet): ContentRatingRuleDecision {
  const safeSource = source || {}
  const staticTagMatched = hasRestrictedCategoryTag(safeSource.categories as string[] | undefined)
  const staticTextMatched = hasRestrictedText({ title: safeSource.title, description: safeSource.description })
  const dynamicMatches = ruleSet.rules.filter((rule) => matchesDynamicContentRatingRule(safeSource, rule))
  const matched = staticTagMatched || staticTextMatched || dynamicMatches.length > 0
  const reasons = [staticTagMatched ? 'tag' : '', staticTextMatched ? 'text' : '', ...dynamicMatches.map((rule) => `rule:${rule.id}`)].filter(Boolean)
  const evidence = [
    ...evidenceForRatingRules({ title: safeSource.title, description: safeSource.description, categories: safeSource.categories }),
    ...dynamicMatches.flatMap((rule) => evidenceForDynamicRule(safeSource, rule)),
  ].slice(0, 20)
  return {
    rating: matched ? 'restricted' : 'unknown',
    matched,
    staticTagMatched,
    staticTextMatched,
    dynamicMatches,
    reasons,
    evidence,
    ruleVersion: ruleSet.version,
  }
}

export function evaluateSingleDynamicRule(
  source: ContentRatingRuleSource | null | undefined,
  rule: DynamicContentRatingRule,
): {
  matched: boolean
  evidence: ContentRatingEvidenceItem[]
} {
  const matched = matchesDynamicContentRatingRule(source, rule)
  return { matched, evidence: matched ? evidenceForDynamicRule(source || {}, rule) : [] }
}
