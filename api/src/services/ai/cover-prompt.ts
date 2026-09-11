import { AiError } from './client'
import type { RomanceVisualDNA } from './cover-romance'
import type { CoverDirection, GenreStyle, ResolvedCoverComposition, ResolvedCoverStylePreset } from './cover-styles'

/** 自动封面提示词的 UTF-16 上限与描述上下文上限。 */
export const COVER_STORY_CONTEXT_MAX_CHARS = 800
/** 当前自动封面四层渲染版本；旧任务仍显式写入 legacy 版本。 */
export const COVER_PROMPT_TEMPLATE_VERSION = 3
export const LEGACY_COVER_PROMPT_TEMPLATE_VERSION = 2

const MIN_COVER_PROMPT_MAX_CHARS = 100
const HARD_MAX_COVER_PROMPT_CHARS = 10_000
const OMISSION_MARKER = ' … [middle omitted] … '

export interface CoverPromptBlock {
  id: string
  text: string
  /** required 块无法删除；超限且无法完整压缩时会返回 invalid，而不是硬截断。 */
  required?: boolean
  /** 数字越小越先删除。 */
  priority?: number
  /** 只能在完整边界上压缩的块。 */
  compact?: (maxChars: number) => string
}

export interface CoverPromptAssemblyArgs {
  scene: string
  style: GenreStyle
  direction: CoverDirection
  platformStyle: string
  titleHint: string
  authorHint: string
  categoryHint: string
  storyHint: string
  renderTitle: boolean
  romanceDNA: RomanceVisualDNA | null
  maxPromptChars?: number
  aspectRatio?: string
}

/**
 * 清理简介，只把它当作素材而不是指令：去掉 HTML、折叠空白，并在 UTF-16 上限内保留头尾完整片段。
 */
export function normalizeCoverStoryContext(value: unknown, maxChars = COVER_STORY_CONTEXT_MAX_CHARS): string {
  const limit = Math.max(1, Math.trunc(Number(maxChars)) || COVER_STORY_CONTEXT_MAX_CHARS)
  const clean = String(value || '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (clean.length <= limit) return clean
  if (limit <= OMISSION_MARKER.length + 2) return safeSliceUtf16(clean, 0, limit)

  const available = limit - OMISSION_MARKER.length
  const headBudget = Math.ceil(available * 0.58)
  const tailBudget = available - headBudget
  let head = takePrefixAtBoundary(clean, headBudget)
  let tail = takeSuffixAtBoundary(clean, tailBudget)

  // 没有句读的长简介也要尽量保留两端；缩短已取片段以保证最终长度严格不超限。
  while (head.length + tail.length > available && (head.length > 1 || tail.length > 1)) {
    if (head.length >= tail.length && head.length > 1) head = safeSliceUtf16(head, 0, head.length - 1).trimEnd()
    else if (tail.length > 1) tail = safeSliceUtf16(tail, 1, tail.length).trimStart()
  }
  const result = `${head}${OMISSION_MARKER}${tail}`.trim()
  return result.length <= limit ? result : safeSliceUtf16(result, 0, limit)
}

/** 别名供单测与调用方使用。 */
export const normalizeCoverContext = normalizeCoverStoryContext

export function normalizeCoverPromptLabel(value: unknown): string {
  return normalizeInlineLabel(value)
}

/** 文本模型不可用时的中性骨架，不替小说补写固定人物、时代道具或地点。 */
export function fallbackCoverScene(composition: ResolvedCoverComposition, storyContext = ''): string {
  const scenes: Record<ResolvedCoverComposition, string> = {
    portrait: 'a premise-led central subject shown through a readable expression, gesture, and one grounded prop, with a restrained setting behind',
    duo: 'two distinct subjects held in a clear relationship gesture and distance, with the premise-grounded setting supporting their tension',
    environment: 'a premise-grounded location carries the narrative while a small readable subject gives the frame scale and direction',
    symbolic: 'one story-defining object or motif becomes the clear foreground focal point, with the people and setting implied through context',
    silhouette: 'a recognizable back view or silhouette is outlined by atmospheric light, with the premise-grounded setting carrying the mood',
    off_center: 'a premise-led subject sits off center beside an open field of atmosphere, with visual movement crossing the frame',
  }
  const context = normalizeCoverStoryContext(storyContext, 220)
  return context ? `${scenes[composition]}; story material anchor: ${context}` : scenes[composition]
}

export function coverPromptSceneBudget(maxPromptChars = 2_000): number {
  const limit = normalizePromptLimit(maxPromptChars)
  return Math.max(40, Math.floor(limit * 0.4))
}

export function compositionSceneInstruction(composition: ResolvedCoverComposition): string {
  const instructions: Record<ResolvedCoverComposition, string> = {
    portrait: 'show one main subject only; keep the background restrained and use a supported gesture or detail',
    duo: 'show two clearly distinct subjects and one readable relationship action; do not turn this into a static object scene',
    environment: 'make the location carry the story; a subject may be absent or occupy only a small readable area',
    symbolic: 'make one object or non-figurative motif the focal point; people are optional and subordinate',
    silhouette: 'use a silhouette, back view, or shadow; do not require a detailed face or expression',
    off_center: 'place one clear subject off center and reserve the opposite side as intentional breathing room',
  }
  return instructions[composition]
}

/** 组装自动模式的统一 prompt；exact 模式不会经过此函数。 */
export function assembleCoverPrompt(args: CoverPromptAssemblyArgs): string {
  const limit = normalizePromptLimit(args.maxPromptChars)
  const renderTitle = args.renderTitle && Boolean(args.titleHint)
  const stylePrompt = compactStylePrompt(args.direction.stylePreset, args.direction.stylePrompt, renderTitle)
  const compositionPrompt = compactCompositionPrompt(args.direction.composition, renderTitle)
  const platformPrompt = compactPlatformPrompt(args.platformStyle, renderTitle)
  const storyHint = normalizeCoverStoryContext(args.storyHint)
  const scene = cleanGeneratedScene(args.scene, renderTitle)
  const sceneBudget = coverPromptSceneBudget(limit)
  const compactedScene = compactScene(scene, sceneBudget, args.direction.composition, storyHint)
  const titleHint = normalizeInlineLabel(args.titleHint)
  const authorHint = normalizeInlineLabel(args.authorHint)
  const blocks: CoverPromptBlock[] = [
    {
      id: 'identity',
      required: true,
      priority: 100,
      text: 'Chinese web novel cover design.',
    },
  ]

  if (platformPrompt) {
    blocks.push({ id: 'platform', priority: 5, text: `${platformPrompt}.` })
  }

  if (args.romanceDNA) {
    blocks.push({
      id: 'romance',
      required: true,
      priority: 80,
      text: `Story-specific romance direction (must drive the image): relationship ${args.romanceDNA.relationshipDynamic}; setting ${args.romanceDNA.setting}; anchor ${args.romanceDNA.visualAnchor}; action ${args.romanceDNA.action}; concept ${args.romanceDNA.visualConcept}.`,
    })
  }
  blocks.push({
    id: 'scene',
    required: true,
    priority: 85,
    text: ensureSentenceEnding(compactedScene),
    compact: (maxChars) => ensureSentenceEnding(compactScene(scene, maxChars, args.direction.composition, storyHint)),
  })
  blocks.push({
    id: 'composition',
    required: true,
    priority: 90,
    text: `Composition: ${compositionPrompt}.`,
  })
  blocks.push({
    id: 'visual',
    required: true,
    priority: 95,
    text: `Genre cue: ${args.style.tag}. Primary visual preset (highest priority): ${stylePrompt}. Follow the selected preset as the single source for visual treatment.`,
  })

  if (renderTitle) {
    blocks.push({
      id: 'text',
      required: true,
      priority: 95,
      text: [
        `Title text '${titleHint}' at top center in ${args.style.titleFont}; use only this exact title and no additional wording.`,
        authorHint ? `Author name '${authorHint}' at bottom center in ${args.style.authorFont}; use only this exact author name.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    })
  }

  const tail = [`Professional novel cover artwork, portrait ${args.aspectRatio || '2:3'} ratio, strong thumbnail readability`]
  if (renderTitle) tail.push('keep title and author name inside the central safe area away from edges (inner ~85%)')
  else tail.push('no text')
  tail.push('avoid generic stock cover layouts, avoid repeated composition, no watermark, no logo, no extra text')
  if (args.romanceDNA) {
    tail.push('keep the relationship legible through the story-specific gesture, setting, or object; avoid a generic posed couple')
  }
  blocks.push({ id: 'constraints', required: true, priority: 70, text: `${tail.join(', ')}.` })

  return renderCoverPromptBlocks(blocks, limit)
}

/** 按块删除/压缩可选内容；不在句中硬截断整个 prompt。 */
export function renderCoverPromptBlocks(blocks: readonly CoverPromptBlock[], maxPromptChars = 2_000): string {
  const limit = normalizePromptLimit(maxPromptChars)
  const normalized = blocks
    .map((block) => ({ ...block, text: normalizeBlockText(block.text) }))
    .filter((block) => block.text.length > 0)
  const compose = (items: readonly CoverPromptBlock[]) => items.map((item) => item.text).join('\n')
  let selected = [...normalized]
  if (compose(selected).length <= limit) return compose(selected)

  // 先去掉不会改变主体语义的外围块，保留视觉方向、场景、约束和 exact 文字层。
  const optional = selected
    .filter((block) => !block.required)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0))
  for (const block of optional) {
    if (compose(selected).length <= limit) break
    selected = selected.filter((candidate) => candidate !== block)
  }
  if (compose(selected).length <= limit) return compose(selected)

  // 只压缩声明了边界策略的块；标题、作者、构图方向和限制语句不会被切半。
  const compactable = selected
    .filter((block) => block.compact)
    .sort((a, b) => b.text.length - a.text.length)
  for (const block of compactable) {
    if (compose(selected).length <= limit) break
    const otherLength = compose(selected.filter((candidate) => candidate !== block)).length
    const available = Math.max(0, limit - otherLength - 1)
    const compacted = block.compact?.(available) || block.text
    if (compacted && compacted.length < block.text.length) {
      selected = selected.map((candidate) => (candidate === block ? { ...candidate, text: compacted } : candidate))
    }
  }
  const result = compose(selected)
  if (result.length > limit) {
    throw new AiError('invalid', `自动封面描述词无法在 ${limit} 个字符内保留完整视觉块`, 422)
  }
  return result
}

export function compactStylePrompt(stylePreset: ResolvedCoverStylePreset, stylePrompt: string, renderTitle: boolean): string {
  if (renderTitle) return stylePrompt
  const replacements: Record<ResolvedCoverStylePreset, string> = {
    cinematic: 'cinematic concept art with a strong focal point, atmospheric depth, controlled lens perspective, layered foreground and background, premium film-poster finish',
    illustration: 'editorial digital illustration with expressive shapes, intentional brushwork, elegant visual storytelling, refined silhouette design, contemporary book-jacket finish',
    ink: 'East Asian ink and color-wash illustration with expressive brush texture, restrained detail, organic negative space, paper grain, and poetic visual rhythm',
    minimal: 'minimalist graphic poster with one memorable visual metaphor, disciplined geometry, generous negative space, restrained palette, and strong thumbnail readability',
    noir: 'noir photographic artwork with hard directional light, deep shadow, atmospheric grain, partial concealment, and a tense independent-film-poster mood',
    graphic: 'modern graphic design with bold color blocking, crisp editorial composition, tactile print texture, and a distinctive visual identity',
    soft_watercolor: 'airy Chinese book-jacket watercolor with translucent peach, ivory, powder-blue, mint, or apricot washes, soft bleeding edges, paper grain, botanical or cloud-like textures, gentle atmosphere, and generous breathing room',
    moonlit_dream: 'poetic moonlit watercolor with layered cobalt, powder blue, icy white, and muted lavender, misty clouds or distant silhouettes, soft luminous bloom, quiet night atmosphere, and open breathing room',
    ancient_guochao: 'refined Chinese guochao ancient-romance illustration with controlled vermilion, jade, ink, and muted gold accents, layered ornamental detail, and a clear readable silhouette',
    romance_illustration: 'polished commercial Chinese web-novel romance illustration with expressive story-specific gestures, clean linework blended with painterly rendering, carefully designed hair and costume details, and a balanced contemporary palette',
    dark_cinematic: 'dark cinematic romance or fantasy artwork with deep plum, navy, charcoal, and black, one controlled crimson or violet accent, dramatic rim light, partial silhouette, atmospheric grain, and premium film-poster restraint',
    pastel_romance: 'soft pastel romance cover with blush, warm ivory, peach, pale lilac, and champagne tones, delicate fabric or architectural details, gentle diffused light, elegant emotional intimacy, and a polished light web-novel finish',
    botanical_literary: 'quiet botanical literary cover with sage, olive, moss, faded blue, and warm paper tones, layered leaves or translucent plant textures, organic brushwork, low visual noise, natural light, and a calm understated mood',
    minimal_typographic: 'quiet minimalist literary cover with an ivory, white, or single pale-tint field, one subtle watercolor wash or symbolic texture, extremely generous negative space, and one restrained visual mark',
  }
  return replacements[stylePreset] || stylePrompt.replace(/title|author|lettering|font|typography/giu, 'visual mark')
}

export function compactCompositionPrompt(composition: ResolvedCoverComposition, renderTitle: boolean): string {
  if (renderTitle) {
    const prompts: Record<ResolvedCoverComposition, string> = {
      portrait: 'close portrait or half-body framing, expressive face and costume details as the primary focal point',
      duo: 'two characters arranged to show their relationship and tension, with clear separation and a readable emotional gesture',
      environment: 'wide environmental storytelling, a small but readable character placed inside a memorable world or location',
      symbolic: 'one story-defining object or motif in the foreground, with the character or setting implied through layered context',
      silhouette: 'recognizable silhouette or back view, strong negative space, atmospheric light outlining the subject, mysterious and restrained',
      off_center: 'asymmetrical off-center composition, intentional empty space for title placement, visual movement leading across the frame',
    }
    return prompts[composition]
  }
  const prompts: Record<ResolvedCoverComposition, string> = {
    portrait: 'close portrait or half-body framing, expressive face and costume details as the primary focal point',
    duo: 'two characters arranged to show their relationship and tension, with clear separation and a readable emotional gesture',
    environment: 'wide environmental storytelling, a small but readable character placed inside a memorable world or location',
    symbolic: 'one story-defining object or motif in the foreground, with the character or setting implied through layered context',
    silhouette: 'recognizable silhouette or back view, strong negative space, atmospheric light outlining the subject, mysterious and restrained',
    off_center: 'asymmetrical off-center composition, intentional empty space balancing the frame, visual movement leading across the frame',
  }
  return prompts[composition]
}

function compactPlatformPrompt(value: string, renderTitle: boolean): string {
  if (!value) return ''
  if (renderTitle) return value
  return value
    .replace(/title-safe margins?/giu, 'subject-safe spacing')
    .replace(/title-safe negative space/giu, 'open negative space')
    .replace(/title/giu, 'visual')
}

function compactScene(value: string, maxChars: number, composition?: ResolvedCoverComposition, storyContext = ''): string {
  const clean = cleanGeneratedScene(value, true)
  if (!clean) return 'a clear story-led focal subject and a premise-grounded setting, rendered with readable depth'
  if (clean.length <= maxChars) return clean
  const sentences = splitSentences(clean)
  const selected: string[] = []
  let length = 0
  for (const sentence of sentences) {
    const next = length + (selected.length ? 1 : 0) + sentence.length
    if (next > maxChars) break
    selected.push(sentence)
    length = next
  }
  if (selected.length) return selected.join(' ')
  if (composition) {
    const fallback = fallbackCoverScene(composition, normalizeCoverStoryContext(storyContext, 120))
    if (fallback.length <= maxChars) return fallback
  }
  return safeWordSlice(clean, maxChars)
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?。！？；;])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

function takePrefixAtBoundary(value: string, maxChars: number): string {
  const candidate = safeSliceUtf16(value, 0, maxChars).trimEnd()
  let offset = 0
  let boundary = 0
  for (const char of candidate) {
    offset += char.length
    if (/[,，.!?。！？；;:：]/u.test(char)) boundary = offset
  }
  if (boundary >= Math.max(20, Math.floor(maxChars * 0.55))) return candidate.slice(0, boundary).trimEnd()
  return safeWordSlice(candidate, candidate.length)
}

function takeSuffixAtBoundary(value: string, maxChars: number): string {
  const start = Math.max(0, value.length - maxChars)
  const candidate = safeSliceUtf16(value, start, value.length).trimStart()
  const match = candidate.search(/[,，.!?。！？；;:：]/u)
  if (match >= 0 && match < Math.floor(maxChars * 0.45)) return candidate.slice(match + 1).trimStart()
  return safeWordSlice(candidate, candidate.length, true)
}

function safeWordSlice(value: string, maxChars: number, fromEnd = false): string {
  if (value.length <= maxChars) return value
  const candidate = fromEnd ? safeSliceUtf16(value, value.length - maxChars, value.length).trimStart() : safeSliceUtf16(value, 0, maxChars).trimEnd()
  if (fromEnd) {
    const space = candidate.indexOf(' ')
    return space >= 0 ? candidate.slice(space + 1).trimStart() : candidate
  }
  const space = candidate.lastIndexOf(' ')
  return space >= Math.floor(candidate.length * 0.45) ? candidate.slice(0, space).trimEnd() : candidate
}

function safeSliceUtf16(value: string, start: number, end: number): string {
  let safeStart = Math.max(0, Math.min(value.length, Math.trunc(start)))
  let safeEnd = Math.max(safeStart, Math.min(value.length, Math.trunc(end)))
  if (safeStart > 0 && /[\uDC00-\uDFFF]/u.test(value[safeStart]!)) safeStart -= 1
  if (safeEnd < value.length && /[\uD800-\uDBFF]/u.test(value[safeEnd - 1]!)) safeEnd -= 1
  return value.slice(safeStart, safeEnd)
}

function cleanGeneratedScene(value: string, renderTitle = true): string {
  const clean = String(value || '')
    .replace(/^['"“”「」]+|['"“”「」]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (renderTitle) return clean
  return clean
    .replace(/\b(?:title|author|font|lettering|typography)\b/giu, 'visual mark')
    .replace(/\b(?:watermark|logo)\b/giu, 'extra mark')
}

function ensureSentenceEnding(value: string): string {
  const clean = String(value || '').trim()
  if (!clean) return 'a clear story-led focal subject and a premise-grounded setting, rendered with readable depth.'
  return /[.!?。！？；;:]$/u.test(clean) ? clean : `${clean}.`
}

function normalizeInlineLabel(value: unknown): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function normalizeBlockText(value: string): string {
  return String(value || '').replace(/\s+\n/gu, '\n').trim()
}

function normalizePromptLimit(value: unknown): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n)
    ? Math.min(HARD_MAX_COVER_PROMPT_CHARS, Math.max(MIN_COVER_PROMPT_MAX_CHARS, n))
    : 2_000
}
