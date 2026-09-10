import { createHash } from 'node:crypto'
import type { Db } from '../../db/pool'
import { first, run, withTx } from '../../db/query'
import { AiError } from './client'
import { getStyleProfileForAnchor } from './style-profile'
import { getPlotStateForAnchor } from './plot-state'
import { getRelationshipProfileForAnchor } from './relationship-profile'
import { parseProfileSource, type ProfileEligibility, type ProfileKind, type ProfileSource } from './profile-source'

const PROFILE_KINDS: ProfileKind[] = ['style', 'plot', 'relationship']
const MAX_OVERRIDE_CHARS = 20_000

export interface ManualProfileOverride {
  content: string
  source?: ProfileSource
  revision: number
  baseProfileRevision: string
  updatedBy: string
  updatedAt: number
}

export interface EffectiveProfileResult {
  profile: string
  source?: ProfileSource
  updatedAt: number
  eligibility: ProfileEligibility
  isOlderThanAnchor: boolean
  manualOverride?: ManualProfileOverride
  effectiveContent: string
  effectiveOrigin: 'manual' | 'automatic' | 'none'
  exclusionReason?: string
  baseProfileRevision: string
}

interface AutomaticProfile {
  profile: string
  source?: ProfileSource
  updatedAt: number
  eligibility: ProfileEligibility
  isOlderThanAnchor: boolean
}

function isProfileKind(value: string): value is ProfileKind {
  return PROFILE_KINDS.includes(value as ProfileKind)
}

function stableProfileRevision(profile: string, source?: ProfileSource): string {
  const sourceValue = source
    ? {
        version: source.version,
        chapterId: source.chapterId,
        chapterTitle: source.chapterTitle,
        sortOrder: source.sortOrder,
        chapterOrdinal: source.chapterOrdinal,
        sampleCount: source.sampleCount,
        samplePolicyVersion: source.samplePolicyVersion,
        fingerprint: source.fingerprint,
      }
    : null
  return createHash('sha256').update(JSON.stringify({ profile, source: sourceValue }), 'utf8').digest('hex')
}

async function automaticProfile(db: Db, kind: ProfileKind, novelId: string, afterChapterId?: string): Promise<AutomaticProfile> {
  if (kind === 'style') return getStyleProfileForAnchor(db, novelId, afterChapterId)
  if (kind === 'plot') {
    const result = await getPlotStateForAnchor(db, novelId, afterChapterId)
    return { profile: result.state, source: result.source, updatedAt: result.updatedAt, eligibility: result.eligibility, isOlderThanAnchor: result.isOlderThanAnchor }
  }
  return getRelationshipProfileForAnchor(db, novelId, afterChapterId)
}

function manualFromRow(row: { content: string; source_json: string; revision: number; base_profile_revision: string; updated_by: string; updated_at: number }): ManualProfileOverride {
  return {
    content: String(row.content || ''),
    source: parseProfileSource(row.source_json),
    revision: Number(row.revision) || 0,
    baseProfileRevision: String(row.base_profile_revision || ''),
    updatedBy: String(row.updated_by || ''),
    updatedAt: Number(row.updated_at) || 0,
  }
}

/** 读取自动画像并按当前起点决定人工层/自动层的最终使用内容。 */
export async function getEffectiveProfileForAnchor(db: Db, opts: { kind: ProfileKind; novelId: string; afterChapterId?: string }): Promise<EffectiveProfileResult> {
  const automatic = await automaticProfile(db, opts.kind, opts.novelId, opts.afterChapterId)
  const baseProfileRevision = stableProfileRevision(automatic.profile, automatic.source)
  const row = await first<{ content: string; source_json: string; revision: number; base_profile_revision: string; updated_by: string; updated_at: number }>(
    db,
    'SELECT content, source_json, revision, base_profile_revision, updated_by, updated_at FROM novel_ai_profile_overrides WHERE novel_id = $1 AND kind = $2',
    [opts.novelId, opts.kind],
  )
  const manualOverride = row ? manualFromRow(row) : undefined
  let exclusionReason: string | undefined
  if (manualOverride) {
    if (automatic.eligibility !== 'usable') exclusionReason = `automatic_${automatic.eligibility}`
    else if (!automatic.source || manualOverride.baseProfileRevision !== baseProfileRevision) exclusionReason = 'base_changed'
    else if (!manualOverride.source || manualOverride.source.fingerprint !== automatic.source.fingerprint) exclusionReason = 'source_changed'
    else if (!manualOverride.content.trim()) exclusionReason = 'empty'
    else return { ...automatic, manualOverride, effectiveContent: manualOverride.content, effectiveOrigin: 'manual', baseProfileRevision }
  }
  if (automatic.eligibility === 'usable' && automatic.profile.trim()) {
    return { ...automatic, manualOverride, effectiveContent: automatic.profile, effectiveOrigin: 'automatic', ...(exclusionReason ? { exclusionReason } : {}), baseProfileRevision }
  }
  return { ...automatic, manualOverride, effectiveContent: '', effectiveOrigin: 'none', ...(exclusionReason ? { exclusionReason } : {}), baseProfileRevision }
}

export async function saveProfileOverride(db: Db, opts: {
  kind: ProfileKind
  novelId: string
  content: string
  expectedRevision: number
  baseProfileRevision: string
  updatedBy: string
  afterChapterId?: string
}): Promise<{ override: ManualProfileOverride; effective: EffectiveProfileResult }> {
  const content = String(opts.content || '').trim()
  if (!content) throw new AiError('invalid', '人工画像不能为空', 422)
  if (Array.from(content).length > MAX_OVERRIDE_CHARS) throw new AiError('invalid', `人工画像超过 ${MAX_OVERRIDE_CHARS} 个 Unicode 标量`, 422)
  const automatic = await automaticProfile(db, opts.kind, opts.novelId, opts.afterChapterId)
  if (automatic.eligibility !== 'usable' || !automatic.source) throw new AiError('invalid', '当前起点没有可绑定的自动画像来源', 422)
  const currentBaseProfileRevision = stableProfileRevision(automatic.profile, automatic.source)
  if (opts.baseProfileRevision !== currentBaseProfileRevision) throw new AiError('conflict', '自动画像已更新，请重新读取后再保存人工校正', 409)
  const now = Date.now()
  const override = await withTx(db, async (q) => {
    await q('SELECT id FROM novels WHERE id = $1 FOR UPDATE', [opts.novelId])
    const existing = await q<{ revision: number }>('SELECT revision FROM novel_ai_profile_overrides WHERE novel_id = $1 AND kind = $2 FOR UPDATE', [opts.novelId, opts.kind])
    const currentRevision = Number(existing.rows[0]?.revision) || 0
    if (currentRevision !== Math.max(0, Math.trunc(opts.expectedRevision))) throw new AiError('conflict', '人工画像已被其他管理员修改，请重新读取', 409)
    const nextRevision = currentRevision + 1
    const sourceJson = JSON.stringify(automatic.source)
    await q(
      `INSERT INTO novel_ai_profile_overrides (novel_id, kind, content, source_json, revision, base_profile_revision, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (novel_id, kind) DO UPDATE SET content = EXCLUDED.content, source_json = EXCLUDED.source_json,
         revision = EXCLUDED.revision, base_profile_revision = EXCLUDED.base_profile_revision, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [opts.novelId, opts.kind, content, sourceJson, nextRevision, currentBaseProfileRevision, opts.updatedBy, now],
    )
    return { content, source: automatic.source, revision: nextRevision, baseProfileRevision: currentBaseProfileRevision, updatedBy: opts.updatedBy, updatedAt: now }
  })
  const effective: EffectiveProfileResult = { ...automatic, manualOverride: override, effectiveContent: content, effectiveOrigin: 'manual', baseProfileRevision: currentBaseProfileRevision }
  return { override, effective }
}

export async function deleteProfileOverride(db: Db, opts: { kind: ProfileKind; novelId: string; expectedRevision: number; afterChapterId?: string }): Promise<EffectiveProfileResult> {
  const effective = await getEffectiveProfileForAnchor(db, { kind: opts.kind, novelId: opts.novelId, afterChapterId: opts.afterChapterId })
  const existingRevision = effective.manualOverride?.revision || 0
  if (existingRevision !== Math.max(0, Math.trunc(opts.expectedRevision))) throw new AiError('conflict', '人工画像已被其他管理员修改，请重新读取', 409)
  await run(db, 'DELETE FROM novel_ai_profile_overrides WHERE novel_id = $1 AND kind = $2 AND revision = $3', [opts.novelId, opts.kind, existingRevision])
  return getEffectiveProfileForAnchor(db, { kind: opts.kind, novelId: opts.novelId, afterChapterId: opts.afterChapterId })
}

export function parseProfileKind(value: string): ProfileKind | undefined {
  return isProfileKind(value) ? value : undefined
}

export { stableProfileRevision }
