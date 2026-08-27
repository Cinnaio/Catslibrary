/**
 * 言情封面视觉 DNA：把标题、分类和简介转换成可见的关系、情绪、场景、物件和动作。
 * 这是纯函数，不调用网络；文本模型只负责把这些确定的锚点润色成画面描述。
 */

export type RomanceSubtype = 'sweet' | 'contract' | 'workplace' | 'campus' | 'reunion' | 'healing' | 'suspense' | 'revenge' | 'historical' | 'general'

export type RomanceEmotion = 'sweet' | 'tension' | 'bittersweet' | 'healing' | 'dangerous' | 'playful'
export type RomanceVisualConcept = 'object' | 'distance' | 'environment' | 'action' | 'threshold' | 'split' | 'silhouette' | 'aftermath'

export interface RomanceVisualDNA {
  subtype: RomanceSubtype
  emotion: RomanceEmotion
  visualConcept: RomanceVisualConcept
  relationshipDynamic: string
  setting: string
  visualAnchor: string
  action: string
  palette: string
  lighting: string
  scenePrompt: string
  prompt: string
}

const CONCEPTS: Array<{ value: RomanceVisualConcept; prompt: string }> = [
  {
    value: 'object',
    prompt:
      'object-led cover concept: make the story-defining object the largest focal point, with the protagonists secondary or implied through its shadow and reflection',
  },
  {
    value: 'distance',
    prompt:
      'emotional-distance cover concept: place the protagonists visibly apart with meaningful negative space between them, showing unresolved tension instead of a posed embrace',
  },
  {
    value: 'environment',
    prompt:
      'environment-led cover concept: let the specific location carry the narrative, with small readable protagonists embedded in the place where their relationship changes',
  },
  {
    value: 'action',
    prompt:
      'decisive-moment cover concept: capture a concrete action at the instant it changes the relationship, with dynamic gesture and a clear visual consequence',
  },
  {
    value: 'threshold',
    prompt:
      'threshold cover concept: frame the relationship through a doorway, window, elevator, train door, or other boundary that expresses hesitation and choice',
  },
  {
    value: 'split',
    prompt:
      'parallel-worlds cover concept: divide the frame between two locations or emotional states, connecting the protagonists through one repeated object or line of light',
  },
  {
    value: 'silhouette',
    prompt:
      'silhouette cover concept: use back views or recognizable silhouettes and let the setting, gesture, and light imply the relationship without a generic beauty portrait',
  },
  {
    value: 'aftermath',
    prompt:
      'aftermath cover concept: show the meaningful traces left after an encounter, such as an abandoned seat, opened letter, broken ornament, or wet pavement, with the protagonists optional and restrained',
  },
]

const SUBTYPE_LABELS: Record<RomanceSubtype, string> = {
  sweet: '甜宠',
  contract: '合约/豪门',
  workplace: '职场关系',
  campus: '校园初恋',
  reunion: '久别重逢',
  healing: '治愈救赎',
  suspense: '悬疑言情',
  revenge: '虐恋复仇',
  historical: '古言爱情',
  general: '现代言情',
}

export const ROMANCE_SUBTYPE_OPTIONS: Array<{ value: RomanceSubtype; label: string }> = Object.entries(SUBTYPE_LABELS).map(([value, label]) => ({
  value: value as RomanceSubtype,
  label,
}))

const EMOTION_LABELS: Record<RomanceEmotion, string> = {
  sweet: '甜蜜',
  tension: '暧昧拉扯',
  bittersweet: '酸涩遗憾',
  healing: '温柔治愈',
  dangerous: '危险克制',
  playful: '轻快俏皮',
}

export const ROMANCE_EMOTION_OPTIONS: Array<{ value: RomanceEmotion; label: string }> = Object.entries(EMOTION_LABELS).map(([value, label]) => ({
  value: value as RomanceEmotion,
  label,
}))

const SUBTYPE_RULES: Array<{ subtype: RomanceSubtype; words: string[] }> = [
  { subtype: 'contract', words: ['合约', '契约', '协议婚姻', '闪婚', '联姻', '婚约', '婚礼'] },
  { subtype: 'suspense', words: ['悬疑', '刑警', '警察', '案件', '追凶', '侦探', '秘密', '危险'] },
  { subtype: 'reunion', words: ['重逢', '久别', '旧爱', '破镜重圆', '再见', '再次遇见'] },
  { subtype: 'healing', words: ['治愈', '救赎', '失眠', '创伤', '病', '医院', '急诊', '心理'] },
  { subtype: 'campus', words: ['校园', '大学', '高中', '同学', '校服', '青春', '学长', '老师'] },
  { subtype: 'workplace', words: ['职场', '公司', '总裁', '投资人', '律师', '设计师', '摄影师', '记者', '医生'] },
  { subtype: 'revenge', words: ['复仇', '虐恋', '替身', '报复', '误会', '背叛'] },
  { subtype: 'historical', words: ['古言', '古代', '宫廷', '王府', '侯府', '将军', '丞相', '江南', '宫斗'] },
  { subtype: 'sweet', words: ['甜宠', '宠妻', '团宠', '暗恋', '撒糖', '日常'] },
]

const RELATIONSHIPS: Record<RomanceSubtype, string> = {
  sweet: 'two people gradually lowering their guard through a small affectionate gesture',
  contract: 'contract partners negotiating power, public appearances, and a private emotional shift',
  workplace: 'two capable professionals whose work roles collide with an unspoken attraction',
  campus: 'two young people at the edge of friendship and first love, with awkward sincere energy',
  reunion: 'former lovers meeting again with visible history, distance, and the possibility of repair',
  healing: 'two wounded people offering practical care while slowly trusting each other',
  suspense: 'two allies investigating a secret while attraction competes with caution and danger',
  revenge: 'lovers or former lovers caught between betrayal, self-protection, and a desire for truth',
  historical: 'two people constrained by family duty and social rules, choosing each other in a classical world',
  general: 'two distinct protagonists connected by a specific unresolved choice rather than a generic romantic pose',
}

const SUBTYPE_SETTINGS: Record<RomanceSubtype, string> = {
  sweet: 'a lived-in neighborhood, kitchen, bookstore, or other intimate everyday place',
  contract: 'a modern penthouse, boardroom, wedding venue, or elevator where public image and private truth collide',
  workplace: 'a specific workplace such as a studio, newsroom, hospital corridor, courtroom, or late-night office',
  campus: 'a campus corridor, library, empty classroom, sports field, or bus stop after school',
  reunion: 'a railway platform, airport arrival hall, old neighborhood, or familiar place changed by time',
  healing: 'a quiet hospital corridor, therapy room, apartment at night, or early-morning street after rain',
  suspense: 'a rain-darkened street, evidence room, bridge, archive, or dim location connected to the case',
  revenge: 'a gala, courtroom, abandoned house, hotel corridor, or other place where a secret can be exposed',
  historical: 'an old courtyard, river town, lantern-lit corridor, garden pavilion, or restrained palace interior',
  general: 'a story-specific location drawn from the premise, never a generic café, garden, or sunset beach',
}

const EMOTION_VISUALS: Record<RomanceEmotion, { palette: string; lighting: string }> = {
  sweet: {
    palette: 'coral, cream, butter yellow, and one fresh teal accent; warm but not uniformly pink',
    lighting: 'clear soft daylight with a small warm practical light, natural and intimate rather than hazy',
  },
  tension: {
    palette: 'charcoal, ivory, deep burgundy, and cold cobalt; restrained contrast with one charged accent',
    lighting: 'hard side light and reflections that keep part of the scene concealed',
  },
  bittersweet: {
    palette: 'dusty blue, faded rose, parchment, and amber; slightly desaturated with a trace of warmth',
    lighting: 'late-afternoon light fading into shadow, suggesting memory and unfinished conversation',
  },
  healing: {
    palette: 'sage green, ivory, powder blue, and muted apricot; calm and breathable',
    lighting: 'gentle morning light through glass, with soft shadows and a sense of recovery',
  },
  dangerous: {
    palette: 'ink black, steel blue, bone white, and a controlled crimson accent; tense and cinematic',
    lighting: 'narrow directional light, wet reflections, and deep shadow with no dreamy bokeh',
  },
  playful: {
    palette: 'turquoise, apricot, butter yellow, and warm white; lively editorial color blocking',
    lighting: 'bright graphic daylight with crisp playful shadows',
  },
}

const ANCHOR_RULES: Array<{ words: string[]; anchor: string }> = [
  { words: ['戒指', '婚戒', '钻戒', '珠宝', '项链'], anchor: 'a single wedding ring or unfinished necklace as the story-defining object' },
  { words: ['相机', '摄影', '照片', '镜头', '拍摄'], anchor: 'an old camera, contact sheet, or half-developed photograph as the story-defining object' },
  { words: ['雨伞', '雨夜', '下雨', '雨中'], anchor: 'one transparent umbrella and rain-slicked pavement as the story-defining visual motif' },
  { words: ['车票', '火车', '车站', '机场', '航班'], anchor: 'a creased train ticket or departure board as the story-defining object' },
  { words: ['医院', '医生', '急诊', '病历', '护士'], anchor: 'a hospital wristband, folded medical chart, or corridor light as the story-defining object' },
  { words: ['信', '书信', '日记', '便签', '短信', '消息'], anchor: 'an opened letter or phone with one unread message as the story-defining object' },
  { words: ['婚礼', '请柬', '婚纱'], anchor: 'a wedding invitation, veil, or empty ceremony chair as the story-defining object' },
]

export function resolveRomanceVisualDNA(args: { title: string; categories?: string[]; description?: string; variationId?: string }): RomanceVisualDNA {
  const text = `${args.title || ''} ${(args.categories || []).join(' ')} ${args.description || ''}`.toLowerCase()
  const subtype = firstSubtype(text)
  const emotion = resolveEmotion(text, subtype)
  const concept = CONCEPTS[stableHash(`${args.variationId || 'default'}|${subtype}`) % CONCEPTS.length]!
  const anchor = firstAnchor(text, subtype, concept.value)
  const setting = resolveSetting(text, subtype)
  const relationshipDynamic = RELATIONSHIPS[subtype]
  const action = resolveAction(subtype, concept.value, anchor)
  const visual = EMOTION_VISUALS[emotion]
  const scenePrompt = `${relationshipDynamic}; ${setting}; ${anchor}; ${action}.`
  const prompt = [
    `romance subtype: ${SUBTYPE_LABELS[subtype]}`,
    `emotional temperature: ${EMOTION_LABELS[emotion]}`,
    `relationship dynamic: ${relationshipDynamic}`,
    `specific setting: ${setting}`,
    `story-defining visual anchor: ${anchor}`,
    `concrete relationship action: ${action}`,
    `visual concept: ${concept.prompt}`,
    `palette: ${visual.palette}`,
    `lighting: ${visual.lighting}`,
  ].join('; ')

  return {
    subtype,
    emotion,
    visualConcept: concept.value,
    relationshipDynamic,
    setting,
    visualAnchor: anchor,
    action,
    palette: visual.palette,
    lighting: visual.lighting,
    scenePrompt,
    prompt,
  }
}

function firstSubtype(text: string): RomanceSubtype {
  return SUBTYPE_RULES.find((rule) => rule.words.some((word) => text.includes(word)))?.subtype || 'general'
}

function resolveEmotion(text: string, subtype: RomanceSubtype): RomanceEmotion {
  if (['suspense', 'revenge'].includes(subtype) || hasAny(text, ['追杀', '凶案', '危险', '秘密', '血', '背叛'])) return 'dangerous'
  if (subtype === 'healing' || hasAny(text, ['治愈', '救赎', '陪伴', '失眠', '创伤'])) return 'healing'
  if (subtype === 'reunion' || hasAny(text, ['重逢', '久别', '遗憾', '离开', '错过', '旧爱'])) return 'bittersweet'
  if (['contract', 'workplace'].includes(subtype) || hasAny(text, ['合约', '契约', '对峙', '误会', '冷面'])) return 'tension'
  if (hasAny(text, ['搞笑', '欢喜', '轻松', '俏皮'])) return 'playful'
  return 'sweet'
}

function firstAnchor(text: string, subtype: RomanceSubtype, concept: RomanceVisualConcept): string {
  const explicit = ANCHOR_RULES.find((rule) => rule.words.some((word) => text.includes(word)))?.anchor
  if (explicit) return explicit
  const fallback: Record<RomanceSubtype, string> = {
    sweet: 'two mismatched coffee cups or a shared grocery list as a small intimate object',
    contract: 'a signed contract beside a ring box as the story-defining object',
    workplace: 'an access card, marked-up draft, or work badge linking the two protagonists',
    campus: 'a library card, handwritten note, or single shared earphone',
    reunion: 'an old photograph or familiar key carried across the years',
    healing: 'a bedside lamp, medicine box, or folded blanket showing practical care',
    suspense: 'a sealed evidence envelope or hidden photograph connected to the secret',
    revenge: 'a torn invitation, redacted file, or object returned after betrayal',
    historical: 'a jade pendant, hairpin, oil-paper fan, or letter in classical surroundings',
    general: 'one specific object from the premise, never a decorative generic romance prop',
  }
  const value = fallback[subtype]
  return concept === 'object' || concept === 'aftermath' ? value : `${value} used as a recurring visual motif`
}

function resolveSetting(text: string, subtype: RomanceSubtype): string {
  if (hasAny(text, ['医院', '医生', '急诊', '病历'])) return 'a hospital corridor or emergency entrance with practical fluorescent and dawn light'
  if (hasAny(text, ['摄影', '相机', '珠宝', '设计师', '工作室'])) return 'a working studio filled with concrete tools, drafts, and unfinished work'
  if (hasAny(text, ['车站', '火车', '机场', '航班'])) return 'a transit space where departure and arrival create visible emotional pressure'
  if (hasAny(text, ['校园', '大学', '高中', '同学'])) return 'a campus location with lived-in details rather than a generic romantic backdrop'
  return SUBTYPE_SETTINGS[subtype]
}

function resolveAction(subtype: RomanceSubtype, concept: RomanceVisualConcept, anchor: string): string {
  if (concept === 'object') return `one protagonist passes, hides, repairs, or discovers ${anchor}`
  if (concept === 'distance') return 'the protagonists move in different directions while one concrete gesture reveals who still cares'
  if (concept === 'environment') return 'the protagonists perform a story-specific task inside the setting, not a static pose'
  if (concept === 'threshold') return 'one protagonist pauses on one side of the boundary while the other chooses whether to turn back'
  if (concept === 'split') return 'the same visual motif connects two separate moments or places in their relationship'
  if (concept === 'silhouette') return 'a back view, reaching hand, or interrupted movement makes the relationship readable from the gesture'
  if (concept === 'aftermath') return 'the setting shows the physical trace of a recent choice, encounter, or separation'
  if (subtype === 'suspense') return 'one protagonist protects evidence while the other watches the danger approaching'
  return 'a concrete gesture of hesitation, care, or confrontation replaces a generic embrace'
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word))
}

function stableHash(value: string): number {
  let hash = 2_166_136_261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}
