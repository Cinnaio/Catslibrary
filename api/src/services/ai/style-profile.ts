/**
 * 小说风格画像 —— novel-continuation-ai skill 的「风格指纹提取」落地。
 *
 * 续写质量取决于 system prompt 里有没有可执行的风格描述。原来只有一句
 * 「保持风格一致」，模型不知道一致指什么；这里取小说前若干章，让文本模型
 * 把语言/叙事/对话/设定四个维度量化提取成一段画像，存进 novel_style_profiles，
 * 续写时拼进 system prompt。一次提取长期复用，写作中途不变（管理员手动刷新）。
 *
 * 这对应 skill 的 Step 2「分析原文风格」——但落成持久化数据，而非每次现分析。
 */
import type { Db } from '../../db/pool'
import { all, first, run } from '../../db/query'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'

/** 默认取样章节数：够模型抓特征，又不至于烧太多 token。 */
export const DEFAULT_STYLE_SAMPLE_CHAPTERS = 5
/** 单章取样字符上限。 */
const STYLE_SAMPLE_CHARS = 3000

/** 取样失败（小说无章节）时的兜底画像：退回原来的通用约束，不阻断续写。 */
export const FALLBACK_STYLE_PROFILE = '保持人物动机、叙事视角和语言风格与上下文一致。'

const STYLE_EXTRACT_SYSTEM = `你是中文网络小说风格分析师。请只根据给定的章节正文，提取这部小说的语言风格特征，不要总结剧情。
从以下四个维度分析，每项 1-2 句话，给出可执行的具体描述（而非空泛评价）：

1. 语言层面：句式偏好（短句凌厉/长句铺陈/对话驱动）、用词风格（文言味/网络语/文学性/白描）、修辞习惯（比喻频率/排比/留白）。
2. 叙事层面：视角（第一/第三人称限知/全知）、节奏（快节奏打斗/慢热日常/章章有高潮）、氛围（严肃/轻松/悬疑/史诗感）。
3. 对话层面：角色说话方式（书面化/口语化/角色专属语气词）、对话占比（密集对话推动剧情/动作描写为主）、潜台词风格（拐弯抹角/直来直去）。
4. 世界观与设定：核心设定关键词（修仙/都市/悬疑/科幻/言情）、主角当前处境与目标、主要配角及关系。
只输出分析结果，不要解释，不要重复正文，不要 Markdown 标题。`

export interface StyleProfileResult {
  profile: string
  model: string
  usage: { promptTokens: number; completionTokens: number }
}

/**
 * 为小说提取风格画像。取样最近若干章已发布正文，调文本模型产出画像，落 novel_style_profiles。
 * 已有画像则覆盖刷新。无章节时写兜底画像并返回，不抛错——续写仍可进行。
 */
export async function extractStyleProfile(db: Db, opts: {
  userId: string
  novelId: string
  ipAddress?: string
  userAgent?: string
}): Promise<StyleProfileResult> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const provider = textProvider()
  const { novelId } = opts

  const rows = await all<{ title: string; content: string }>(
    db,
    'SELECT title, content FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC LIMIT $2',
    [novelId, DEFAULT_STYLE_SAMPLE_CHAPTERS],
  )
  const now = Date.now()
  const settings = await getAiSettings(db)
  // 无章节：写兜底画像，让续写拿得到一段可用的风格约束
  if (!rows.length) {
    await run(
      db,
      `INSERT INTO novel_style_profiles (novel_id, profile, model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (novel_id) DO UPDATE SET profile = EXCLUDED.profile, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at`,
      [novelId, FALLBACK_STYLE_PROFILE, '', now],
    )
    return { profile: FALLBACK_STYLE_PROFILE, model: '', usage: { promptTokens: 0, completionTokens: 0 } }
  }

  const sample = rows.reverse().map((row) => `【${row.title}】\n${cleanForSample(row.content)}`).join('\n\n')
  const res = await chat({
    messages: [
      { role: 'system', content: STYLE_EXTRACT_SYSTEM },
      { role: 'user', content: `作品正文样例：\n${sample}` },
    ],
    temperature: 0.3,
    maxTokens: settings.styleProfileMaxTokens,
    timeoutMs: 120_000,
  })
  const profile = res.text.trim() || FALLBACK_STYLE_PROFILE
  await run(
    db,
    `INSERT INTO novel_style_profiles (novel_id, profile, model, created_at, updated_at)
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
    generationType: 'style_profile',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
  return { profile, model: res.model, usage: { promptTokens: res.promptTokens, completionTokens: res.completionTokens } }
}

/** 读取已存的风格画像；未提取过返回空串，调用方决定是否兜底。 */
export async function getStyleProfile(db: Db, novelId: string): Promise<string> {
  const row = await first<{ profile: string }>(db, 'SELECT profile FROM novel_style_profiles WHERE novel_id = $1', [novelId])
  return row?.profile || ''
}

/** 清洗取样正文：去广告/HTML/多余空白，单章截断。 */
function cleanForSample(raw: string): string {
  return String(raw || '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, STYLE_SAMPLE_CHARS)
}
