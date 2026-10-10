/**
 * 书籍导入的 AI 边界复核。
 *
 * 定位：不替换解析器，只裁决「证据不足」的少数行。确定性启发式照旧跑
 * （零成本、零延迟、可复现），模型只回答「这些候选行里哪些是章节标题」。
 *
 * 三条硬约束写在实现里：
 * 1. 模型不参与编号归一化 —— 幂等键一变，库里已存在的章节会被整片误判成新增。
 * 2. 不进导入主链路 —— preview 同步请求只跑启发式，复核是管理员主动触发的独立动作。
 * 3. 只送候选行 —— 全量送模型既烧钱又超时，且多数行本来就不需要裁决。
 */
import type { BookImportAiReview, BookImportAiSuggestion, BookImportDiagnostics, BookImportLineEvidence } from '@shared/types'
import type { Db } from '../../db/pool'
import { AiError, chat, isTextAiConfigured, providerLabel, textProvider } from './client'
import { getAiSettings } from './settings'
import { recordUsage } from './usage'
import { usageAuditFields } from './upstream-usage'

/** 送模型的单行原文与上下文截断长度：够判断形态，又不至于让 token 失控。 */
const MAX_PROMPT_RAW = 60
const MAX_PROMPT_CONTEXT = 30

export interface ImportReviewOutcome {
  review: BookImportAiReview
  /** 建议强制视为章节标题的行号（1-based）。启发式漏判的行。 */
  forceHeadings: number[]
  /** 建议否决的行号（1-based）。启发式误判的行。 */
  denyHeadings: number[]
}

/**
 * 从模型回复里抽出「判定为标题」的行号集合。
 *
 * 按「JSON 优先、数字兜底」两级解析：模型可能带 Markdown 代码块或解释文字。
 * 只保留候选集合内的行号——模型臆造的行号若放行，会切出原文里并不存在的边界。
 */
export function parseImportReviewReply(text: string, candidates: BookImportLineEvidence[]): Set<number> {
  const allowed = new Set(candidates.map((item) => item.line))
  const raw = String(text || '')
  const collected: number[] = []
  /**
   * 是否拿到了可信的 JSON 结论。这一步不能省：
   * 模型回 `{"headings":[]}` 是在明确表示「没有一行是标题」，
   * 若把它当「解析失败」落入数字兜底，回复里的解释文字（「第 12 行不是标题」）
   * 会被当成标题行号，把模型明确的否决反向执行成强制命中。
   */
  let trusted = false

  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as { headings?: unknown }
      if (Array.isArray(parsed.headings)) {
        trusted = true
        for (const value of parsed.headings) {
          const line = Math.trunc(Number(value))
          if (Number.isFinite(line)) collected.push(line)
        }
      }
    } catch {
      // 落到数字兜底：模型只回了「12, 47, 88」这类列表
    }
  }
  if (!trusted) {
    for (const match of raw.matchAll(/\d+/g)) {
      const line = Number(match[0])
      if (Number.isFinite(line)) collected.push(line)
    }
  }
  return new Set(collected.filter((line) => allowed.has(line)))
}

/** 候选行渲染成模型可读的紧凑表格。 */
export function buildImportReviewMessage(candidates: BookImportLineEvidence[]): string {
  const rows = candidates.map((item) => {
    const before = (item.contextBefore || '').slice(0, MAX_PROMPT_CONTEXT)
    const after = (item.contextAfter || '').slice(0, MAX_PROMPT_CONTEXT)
    return `${item.line} | ${item.raw.slice(0, MAX_PROMPT_RAW)} | 上一行: ${before} | 下一行: ${after}`
  })
  return `候选行（行号 | 该行原文 | 上一行 | 下一行）：\n${rows.join('\n')}\n\n请输出 JSON。`
}

/**
 * 复核导入的章节边界。候选取自诊断里的 uncertain 行（已按风险排序：
 * 漏判优先于误判）。无候选时不调用模型，直接返回空结果。
 */
export async function reviewImportHeadings(
  db: Db,
  opts: {
    userId: string
    diagnostics: BookImportDiagnostics
    ipAddress?: string
    userAgent?: string
  },
): Promise<ImportReviewOutcome> {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const settings = await getAiSettings(db)
  const candidates = opts.diagnostics.uncertain.slice(0, settings.importAiMaxCandidates)
  const reviewedAt = Date.now()
  if (!candidates.length) {
    return {
      review: {
        reviewedAt,
        model: '',
        heuristicVersion: opts.diagnostics.heuristicVersion,
        candidateCount: 0,
        suggestions: [],
        projectedChapterCount: 0,
        usage: { promptTokens: 0, completionTokens: 0, costMillicents: 0 },
      },
      forceHeadings: [],
      denyHeadings: [],
    }
  }

  const provider = textProvider()
  const res = await chat({
    messages: [
      { role: 'system', content: settings.importAiSystemPrompt },
      { role: 'user', content: buildImportReviewMessage(candidates) },
    ],
    // 边界裁决要的是稳定复现，不是发挥：温度归零。
    temperature: 0,
    maxTokens: settings.importAiMaxTokens,
    timeoutMs: 120_000,
  })

  const headings = parseImportReviewReply(res.text, candidates)
  // 只保留与启发式不一致的判定：一致的结论没有行动价值，列出来只会淹没真正的改判。
  const suggestions: BookImportAiSuggestion[] = candidates
    .map((item): BookImportAiSuggestion => {
      const verdict = headings.has(item.line) ? 'heading' : 'prose'
      return {
        line: item.line,
        raw: item.raw,
        heuristic: item.verdict,
        verdict,
        confidence: item.confidence,
        reason: item.rejectedBy ? `启发式否决：${item.rejectedBy}` : `启发式命中：${item.rule}`,
      }
    })
    .filter((item) => item.verdict !== item.heuristic)

  const forceHeadings = suggestions.filter((item) => item.verdict === 'heading').map((item) => item.line)
  const denyHeadings = suggestions.filter((item) => item.verdict === 'prose').map((item) => item.line)

  await recordUsage(db, {
    userId: opts.userId,
    model: res.model,
    provider: providerLabel(provider.baseUrl),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    ...usageAuditFields(res),
    costMillicents: res.cost * 100000,
    generationType: 'import_review',
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })

  return {
    review: {
      reviewedAt,
      model: res.model,
      heuristicVersion: opts.diagnostics.heuristicVersion,
      candidateCount: candidates.length,
      suggestions,
      // 预计章节数由调用方按建议重跑确定性切分得出，这里不猜。
      projectedChapterCount: 0,
      usage: { promptTokens: res.promptTokens, completionTokens: res.completionTokens, costMillicents: res.cost * 100000 },
    },
    forceHeadings,
    denyHeadings,
  }
}
