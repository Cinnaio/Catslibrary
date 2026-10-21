/** 关系档案：全历史分批初始化，保留关系形成、变化原因和章节来源。 */
import type { Db } from '../../db/pool'
import { advanceStoryMemory, cleanStoryText, type StoryMemoryOptions, type StoryMemoryResult } from './story-memory'
import { first } from '../../db/query'
import { evaluateProfileSource, type ProfileEligibility, type ProfileSource } from './profile-source'

/** 默认每批章节上限；不限制历史覆盖范围。 */
export const DEFAULT_RELATIONSHIP_SAMPLE_CHAPTERS = 10

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

export interface RelationshipProfileResult extends Omit<StoryMemoryResult, 'content'> {
  profile: string
}

/** Advance one resumable batch over the complete chapter prefix. */
export async function extractRelationshipProfile(db: Db, opts: StoryMemoryOptions): Promise<RelationshipProfileResult> {
  const { content, ...result } = await advanceStoryMemory(db, 'relationship', RELATIONSHIP_EXTRACT_SYSTEM, opts)
  return { ...result, profile: content }
}

/** 读取已存的关系画像；未提取过返回空串，调用方决定是否兜底。 */
export async function getRelationshipProfile(db: Db, novelId: string): Promise<string> {
  const row = await first<{ profile: string }>(db, 'SELECT profile FROM novel_relationship_profiles WHERE novel_id = $1', [novelId])
  return row?.profile || ''
}

export async function getRelationshipProfileForAnchor(
  db: Db,
  novelId: string,
  afterChapterId?: string,
): Promise<{
  profile: string
  source?: ProfileSource
  updatedAt: number
  eligibility: ProfileEligibility
  isOlderThanAnchor: boolean
}> {
  return evaluateProfileSource(db, { kind: 'relationship', novelId, afterChapterId, clean: cleanForSample })
}

/** Full normalized text is also used when checking archive invalidation. */
const cleanForSample = cleanStoryText
