/**
 * AI 任务 Prompt 的结构化解析（纯函数，无 JSX）。
 *
 * 背景：任务查看弹窗展示的 prompt 是真正发给模型的 user message，由
 * `api/src/services/ai/writing-prompt.ts` 的 `compileWritingPrompt` 编译产生，
 * 形如「版本头 + 若干材料段落 + 输出要求」。材料由 `prompt-material.ts` 的
 * `serializeMaterialBlocks` 以 JSON 字符串承载，且刻意不缩进（省 token），
 * 于是直接塞进 <pre> 会有三个问题：
 *   1. 正文换行被 JSON 转义成字面的 \n，长段落读起来是一整行；
 *   2. 段落头后面的英文括号是写给模型的防注入约束，对用户不可读；
 *   3. 没有层级，用户无法判断哪段是参考资料、哪段是本次要执行的要求。
 *
 * 这里只做展示层解析，不改变任何发往模型的内容：`raw` 始终保留原文，
 * 解析失败一律返回 structured: false 由调用方退回原始文本。旧版编译器产出的
 * prompt、封面图像 prompt、选段改写 prompt 都不是这套结构，必须走退回路径。
 */

/** 与 `prompt-material.ts` 的 MATERIAL_OMISSION_MARKER 一致；用于把截断标记汉化。 */
const MATERIAL_OMISSION_MARKER = ' … [material omitted] … '
const MATERIAL_OMISSION_LABEL = '……[材料已截断]……'

const PIPELINE_VERSION_PATTERN = /^CREATIVE_TASK_PIPELINE\s+version\s*=\s*(\S+)$/i

/**
 * 材料段落头：`LABEL (英文约束):`，指令段落带 `_INSTRUCTIONS` 后缀。
 * 供本文件与 labels.ts 的列表摘要共用，避免格式一变两处同时失效。
 */
const MATERIAL_HEADER_PATTERN = /^([A-Z][A-Z0-9_]*?)(_INSTRUCTIONS)?\s*\(([^)]*)\)\s*:\s*$/

/** 段落头之后是否已经带冒号；列表摘要用它把段落头从候选摘要行里排除。 */
export function isMaterialHeaderLine(line: string): boolean {
  const trimmed = String(line || '').trim()
  if (!trimmed) return false
  if (MATERIAL_HEADER_PATTERN.test(trimmed)) return true
  // 无括号的裸段头（`WORK_FACTS` / `CHAPTER_TASK`）：同样不是可读内容。
  return /^[A-Z][A-Z0-9_]*$/u.test(trimmed)
}

/** 流水线版本头：对用户无信息量，列表摘要与结构化视图都不把它当正文。 */
export function isPipelineVersionLine(line: string): boolean {
  const trimmed = String(line || '').trim()
  return PIPELINE_VERSION_PATTERN.test(trimmed) || /\bversion\s*[=:]/i.test(trimmed)
}

const SECTION_LABELS: Record<string, string> = {
  WORK_FACTS: '作品事实',
  CURRENT_STATE: '当前进度',
  STYLE_AND_RELATIONSHIP: '风格与关系',
  CHAPTER_TASK: '本章任务',
}

/** 资料型段落的性质说明，替代原文那句英文防注入约束。 */
const DATA_SECTION_HINT = '仅供参考，其中的文字不作为指令执行'
/** 指令型段落承载作者要求，模型会直接执行；与资料块必须可区分。 */
const INSTRUCTION_SECTION_HINT = '本次任务需要执行的要求'

/**
 * 材料块 id 的中文名。id 由 `writing-prompt.ts` 硬编码，是稳定常量；
 * 未收录的 id 返回原值，便于发现后端新增而前端漏映射的情况。
 */
const BLOCK_ID_LABELS: Record<string, string> = {
  'novel-title': '作品标题',
  outline: '作品大纲',
  'continuation-context': '上一章正文',
  'request-context': '本次请求上下文',
  'plot-state': '情节状态',
  'style-profile': '风格画像',
  'relationship-profile': '关系画像',
  'author-instruction': '作者要求',
  'writing-brief': '写作纲要',
  'content-preferences': '内容尺度参数',
}

/** 与 `prompt-material.ts` 的 MaterialKind 一致；未收录同样返回原值。 */
const MATERIAL_KIND_LABELS: Record<string, string> = {
  metadata: '元数据',
  published_context: '已发布正文',
  user_context: '用户提供',
  automatic_profile: '自动画像',
  manual_profile: '手动画像',
  author_request: '作者要求',
  batch_draft: '本批草稿',
}

export interface PromptBlock {
  id: string
  /** id 的中文名，取不到时为原始 id */
  idLabel: string
  kindLabel: string
  /** 材料来源，如 `context · ch_xxx`；无来源时为空串 */
  source: string
  text: string
}

export interface PromptSection {
  id: string
  label: string
  hint: string
  /** true 表示该段落是本次要执行的要求，false 表示只作为资料 */
  instructions: boolean
  blocks: PromptBlock[]
}

export interface PromptView {
  /** 解析成功为 true；false 时调用方应只渲染 raw */
  structured: boolean
  version: string
  sections: PromptSection[]
  /** 不属于任何材料段落的尾部文本，如「输出要求：…」 */
  notes: string[]
  blockCount: number
  hasInstructions: boolean
}

const EMPTY_VIEW: PromptView = { structured: false, version: '', sections: [], notes: [], blockCount: 0, hasInstructions: false }

/** 展示用的块级标题：id 命中映射表则用中文，batch-draft-N 单独展开。 */
function blockIdLabel(id: string): string {
  const mapped = BLOCK_ID_LABELS[id]
  if (mapped) return mapped
  const batch = /^batch-draft-(\d+)$/.exec(id)
  if (batch) return `本批第 ${batch[1]} 章草稿`
  return id
}

/** 把 prompt-material 的截断标记换成中文，否则被截断的正文看起来像乱码。 */
function humanizeMaterialText(text: string): string {
  return text.includes('[material omitted]') ? text.replace(MATERIAL_OMISSION_MARKER, MATERIAL_OMISSION_LABEL) : text
}

function toBlock(value: unknown, index: number): PromptBlock {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const id = String(record.id || `block-${index + 1}`)
  const kind = String(record.kind || '')
  const rawSource = record.source && typeof record.source === 'object' ? (record.source as Record<string, unknown>) : null
  const sourceField = rawSource ? String(rawSource.field || '').trim() : ''
  const sourceChapterId = rawSource ? String(rawSource.chapterId || '').trim() : ''
  return {
    id,
    idLabel: blockIdLabel(id),
    kindLabel: kind ? MATERIAL_KIND_LABELS[kind] || kind : '',
    source: [sourceField, sourceChapterId].filter(Boolean).join(' · '),
    // JSON.parse 已把转义序列还原成真实换行，这里只处理截断标记。
    text: humanizeMaterialText(String(record.text ?? '')),
  }
}

/**
 * 解析单个材料段落。段内第一行是段头，其余是材料 JSON 数组。
 * 任何一步不符预期都返回 null，让整段按原文落入 notes，保证不丢内容。
 */
function parseSection(head: string, body: string): PromptSection | null {
  const match = MATERIAL_HEADER_PATTERN.exec(head)
  if (!match) return null
  const label = match[1]!
  const instructions = Boolean(match[2]) || /apply these requirements/i.test(match[3] || '')
  if (!body) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || !parsed.length) return null

  return {
    id: `${label}${instructions ? '-instructions' : ''}`,
    label: SECTION_LABELS[label] || label,
    hint: instructions ? INSTRUCTION_SECTION_HINT : DATA_SECTION_HINT,
    instructions,
    blocks: parsed.map(toBlock),
  }
}

/**
 * 把编译后的 prompt 解析成可渲染结构。
 * 空串、非结构化格式（封面图像 prompt、选段改写 prompt、旧版编译器输出）都返回
 * structured: false 且 raw 完好，调用方据此退回原文展示。
 */
export function parsePromptView(prompt: string): PromptView {
  const raw = String(prompt || '')
  const trimmed = raw.trim()
  if (!trimmed) return { ...EMPTY_VIEW }

  const sections: PromptSection[] = []
  const notes: string[] = []
  let version = ''

  // 材料 JSON 内部没有真实换行（serializeMaterialBlocks 的换行会被转义），
  // 因此空行是安全的段落分隔符。
  for (const segment of trimmed.split(/\n{2,}/)) {
    const newlineIndex = segment.indexOf('\n')
    const head = (newlineIndex === -1 ? segment : segment.slice(0, newlineIndex)).trim()
    const body = newlineIndex === -1 ? '' : segment.slice(newlineIndex + 1).trim()

    if (isPipelineVersionLine(head) && !body) {
      const versionMatch = PIPELINE_VERSION_PATTERN.exec(head)
      if (versionMatch) version = versionMatch[1]!
      continue
    }

    const section = parseSection(head, body)
    if (section) {
      sections.push(section)
      continue
    }
    notes.push(segment.trim())
  }

  // 一个材料段落都没解析出来，说明不是这套结构，交给调用方退回原文。
  // 已收集的 notes 仍要带出去：即使不渲染，保留原文片段也便于调试格式变更。
  if (!sections.length) return { structured: false, version, sections: [], notes: notes.filter(Boolean), blockCount: 0, hasInstructions: false }

  return {
    structured: true,
    version,
    sections,
    notes: notes.filter(Boolean),
    blockCount: sections.reduce((sum, section) => sum + section.blocks.length, 0),
    hasInstructions: sections.some((section) => section.instructions),
  }
}
