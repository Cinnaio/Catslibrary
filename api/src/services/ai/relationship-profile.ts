/**
 * 小说关系画像 —— novel-continuation-ai skill 的「主从权力动态/心理边界」落地。
 *
 * 成人向言情（主从/控制/甜头奖惩）这类题材续写最容易翻车的地方，skill 已踩过坑：
 *   - 把主从关系写成平等恋人（从属突然有资格质问/提要求）
 *   - 把控制手段（奖赏/甜头）理解成真心感情
 *   - 从属的试探被写成主导
 * 这里取小说若干章，让文本模型提炼出这本书的角色关系动态、权力结构、心理边界与
 * 互动尺度基调，存进 novel_relationship_profiles，续写时拼进 system prompt。
 *
 * 关系画像是「人物之间稳定的关系底色」，几十章内不变，与情节状态（频繁变化的当前
 * 进展）区分；放 system（长期纪律层），与风格画像并列。
 */
import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'

/** 默认取样章节数：关系动态比情节状态稳定，取稍长窗口看清关系演变。 */
export const DEFAULT_RELATIONSHIP_SAMPLE_CHAPTERS = 10
/** 单章取样字符上限。 */
const RELATIONSHIP_SAMPLE_CHARS = 3000

/** 取样失败（小说无章节）时的兜底：返回空，续写时跳过注入不阻断。 */
export const FALLBACK_RELATIONSHIP_PROFILE = ''

const RELATIONSHIP_EXTRACT_SYSTEM = `你是中文小说角色关系分析师。请只根据给定的章节正文，提炼角色之间的关系动态，不要复述剧情经过。
按以下四块输出，每块用列表罗列，条目具体到人名与关系，不要空泛：

1. 关系动态：每对主要角色之间谁主导、谁从属，权力结构如何（支配/依附/平等/博弈），权力来源（身份/情感/能力/信息）。
2. 心理边界：从属角色在什么缝隙里试探、如何试探（没有资格直接提要求）；主导者如何运用奖赏/甜头（是策略、控制工具，还是心情好的施舍），奖惩机制是什么。
3. 互动基调：情感/身体互动的尺度与氛围（克制/炽烈/暧昧/直接），是控制与服从的张力还是温情流露，互动推进的节奏。
4. 雷区：若把主导者写成有感情的普通恋人、把从属写成有资格质问、把奖赏手段理解成真心喜欢，就会崩人设——列出本书当前不该逾越的关系边界。

重要约束：
- 所有判断必须来自正文表现，正文未明确的不要臆造。
- 关系以原文为准：不要美化、不要把主从关系改写成平等，不要把控制手段理解成感情。
- 只输出分析结果，不要解释，不要重复正文，不要 Markdown 标题，用「1.」「2.」「3.」「4.」标记四块即可。`

export interface RelationshipProfileResult {
  profile: string
  model: string
  usage: { promptTokens: number; completionTokens: number }
}

/**
 * 为小说提取关系画像。取样最近 N 章已发布正文（N 可配，默认 10），调文本模型产出画像，
 * 落 novel_relationship_profiles。已有画像则覆盖刷新。无章节时写空画像并返回，不抛错。
 */
export async function extractRelationshipProfile(db: Db, opts: {
  userId: string
  novelId: string
  /** 取样最近多少章正文，默认 10，范围 1-30。 */
  sampleChapters?: number
  ipAddress?: string
  userAgent?: string
}): Promise<RelationshipProfileResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const { novelId } = opts
  const sampleChapters = Math.min(30, Math.max(1, Math.trunc(Number(opts.sampleChapters)) || DEFAULT_RELATIONSHIP_SAMPLE_CHAPTERS))

  const rows = await all<{ title: string; content: string }>(
    db,
    'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT $2',
    [novelId, sampleChapters],
  )
  const now = Date.now()
  const settings = await getAiSettings(db)
  // 无章节：写空画像，让续写跳过注入
  if (!rows.length) {
    await run(
      db,
      `INSERT INTO novel_relationship_profiles (novel_id, profile, model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (novel_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at`,
      [novelId, FALLBACK_RELATIONSHIP_PROFILE, '', now],
    )
    return { profile: FALLBACK_RELATIONSHIP_PROFILE, model: '', usage: { promptTokens: 0, completionTokens: 0 } }
  }

  const sample = rows.reverse().map((row) => `【${row.title}】\n${cleanForSample(row.content)}`).join('\n\n')
  const res = await chat({
    messages: [
      { role: 'system', content: RELATIONSHIP_EXTRACT_SYSTEM },
      { role: 'user', content: `作品正文样例（最近 ${rows.length} 章）：\n${sample}` },
    ],
    temperature: 0.3,
    maxTokens: settings.relationshipProfileMaxTokens,
    timeoutMs: 120_000,
  })
  const profile = res.text.trim() || FALLBACK_RELATIONSHIP_PROFILE
  await run(
    db,
    `INSERT INTO novel_relationship_profiles (novel_id, profile, model, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (novel_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at`,
    [novelId, profile, res.model, now],
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
  return { profile, model: res.model, usage: { promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

/** 读取已存的关系画像；未提取过返回空串，调用方决定是否兜底。 */
export async function getRelationshipProfile(db: Db, novelId: string): Promise<string> {
  const row = await first<{ profile: string }>(db, 'SELECT profile FROM novel_relationship_profiles WHERE novel_id = $1', [novelId])
  return row?.profile || ''
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
