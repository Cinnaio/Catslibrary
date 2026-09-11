/**
 * 小说关系画像 —— novel-continuation-ai skill 的「主从权力动态/心理边界」落地。
 *
 * 这里取小说若干章，让文本模型提炼出这本书的角色关系动态、权力结构、心理边界与
 * 互动尺度基调，存进 novel_relationship_profiles，续写时作为带来源的关系材料注入。
 *
 * 关系画像是「人物之间稳定的关系底色」，几十章内不变，与情节状态（频繁变化的当前
 * 进展）区分；在新编译器中与风格画像并列作为材料块。
 */
import type { Db } from '../../db/pool'
import { first, run } from '../../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'
import { evaluateProfileSource, loadProfileSample, sampleText, type ProfileEligibility, type ProfileSource } from './profile-source'

/** 默认取样章节数：关系动态比情节状态稳定，取稍长窗口看清关系演变。 */
export const DEFAULT_RELATIONSHIP_SAMPLE_CHAPTERS = 10
/** 单章取样字符上限。 */
const RELATIONSHIP_SAMPLE_CHARS = 3000

/** 取样失败（小说无章节）时的兜底：返回空，续写时跳过注入不阻断。 */
export const FALLBACK_RELATIONSHIP_PROFILE = ''

const RELATIONSHIP_EXTRACT_SYSTEM = `你是中文小说角色关系分析师。请只根据给定的章节正文，提炼角色之间的关系动态，不要复述剧情经过。
按以下四块输出，每块用列表罗列，条目具体到人名与关系，不要空泛：

1. 关系动态：每对主要角色的目标、依赖、信任、冲突与互动方式；只有正文明确支持时才描述权力不对称，并说明权力来源（身份/情感/能力/信息）。允许关系平等、非恋爱、变化中或证据不足。
2. 心理边界：角色如何提出请求、拒绝、试探或让步；区分正文证据与分析推断，不把照顾、奖赏或控制自动解释成爱情。
3. 互动基调：情感/身体互动的尺度与氛围（克制/炽烈/暧昧/直接），关系推进的节奏与已发生的变化。
4. 雷区：列出正文明确不应逾越的关系边界；如果正文没有足够证据，明确写“未确认”，不要替作品补出主从结构。

重要约束：
- 所有判断必须来自正文表现，正文未明确的不要臆造。
- 关系以原文为准：不要美化、不要把平等关系改写成主从，也不要把主从、依赖或控制擅自改写成爱情。
- 只输出分析结果，不要解释，不要重复正文，不要 Markdown 标题，用「1.」「2.」「3.」「4.」标记四块即可。`

export interface RelationshipProfileResult {
  profile: string
  model: string
  usage: { promptTokens: number; completionTokens: number }
  source?: ProfileSource
  updatedAt?: number
}

/**
 * 为小说提取关系画像。取样最近 N 章已发布正文（N 可配，默认 10），调文本模型产出画像，
 * 落 novel_relationship_profiles。已有画像则覆盖刷新。无章节时写空画像并返回，不抛错。
 */
export async function extractRelationshipProfile(db: Db, opts: {
  userId: string
  novelId: string
  afterChapterId?: string
  /** 取样最近多少章正文，默认 10，范围 1-30。 */
  sampleChapters?: number
  ipAddress?: string
  userAgent?: string
}): Promise<RelationshipProfileResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const { novelId } = opts
  const sampleChapters = Math.min(30, Math.max(1, Math.trunc(Number(opts.sampleChapters)) || DEFAULT_RELATIONSHIP_SAMPLE_CHAPTERS))

  const sample = await loadProfileSample(db, { novelId, afterChapterId: opts.afterChapterId, sampleCount: sampleChapters, clean: cleanForSample })
  const now = Date.now()
  const settings = await getAiSettings(db)
  // 无章节：写空画像，让续写跳过注入
  if (!sample) {
    await run(
      db,
      `INSERT INTO novel_relationship_profiles (novel_id, profile, model, source_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (novel_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, source_json = EXCLUDED.source_json, updated_at = EXCLUDED.updated_at`,
      [novelId, FALLBACK_RELATIONSHIP_PROFILE, '', '', now],
    )
    return { profile: FALLBACK_RELATIONSHIP_PROFILE, model: '', updatedAt: now, usage: { promptTokens: 0, completionTokens: 0 } }
  }

  const sampleTextValue = sampleText(sample, cleanForSample)
  const persistedSource: ProfileSource = { ...sample.source, extractionPromptVersion: 2 }
  const res = await chat({
    messages: [
      { role: 'system', content: RELATIONSHIP_EXTRACT_SYSTEM },
      { role: 'user', content: `作品正文样例（最近 ${sample.rows.length} 章）：\n${sampleTextValue}` },
    ],
    temperature: 0.3,
    maxTokens: settings.relationshipProfileMaxTokens,
    timeoutMs: 120_000,
  })
  const profile = res.text.trim() || FALLBACK_RELATIONSHIP_PROFILE
  await run(
    db,
    `INSERT INTO novel_relationship_profiles (novel_id, profile, model, source_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (novel_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, source_json = EXCLUDED.source_json, updated_at = EXCLUDED.updated_at`,
    [novelId, profile, res.model, JSON.stringify(persistedSource), now],
  )
  await recordUsage(db, {
    userId: opts.userId,
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    costMillicents: Math.round(res.cost * 100000),
    novelId,
    generationType: 'relationship_profile',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
  return { profile, model: res.model, source: persistedSource, updatedAt: now, usage: { promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

/** 读取已存的关系画像；未提取过返回空串，调用方决定是否兜底。 */
export async function getRelationshipProfile(db: Db, novelId: string): Promise<string> {
  const row = await first<{ profile: string }>(db, 'SELECT profile FROM novel_relationship_profiles WHERE novel_id = $1', [novelId])
  return row?.profile || ''
}

export async function getRelationshipProfileForAnchor(db: Db, novelId: string, afterChapterId?: string): Promise<{
  profile: string
  source?: ProfileSource
  updatedAt: number
  eligibility: ProfileEligibility
  isOlderThanAnchor: boolean
}> {
  return evaluateProfileSource(db, { kind: 'relationship', novelId, afterChapterId, clean: cleanForSample })
}

/** 清洗取样正文：去 HTML/多余空白，单章截断。 */
function cleanForSample(raw: string): string {
  return String(raw || '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, RELATIONSHIP_SAMPLE_CHARS)
}
