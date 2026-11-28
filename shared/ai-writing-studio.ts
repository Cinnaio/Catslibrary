/** Author-controlled writing material; proposals and simulations are never story facts. */
export const STUDIO_KINDS = ['scene', 'voice', 'reading', 'knowledge', 'relationship', 'preference'] as const
export type StudioKind = typeof STUDIO_KINDS[number]
export type StudioScope = 'session' | 'book' | 'personal'
export interface StudioField { key: string; label: string; limit: number; required?: boolean; options?: string[] }
export interface StudioDefinition { label: string; description: string; prompt: string; fields: StudioField[] }
export const STUDIO_DEFINITIONS: Record<StudioKind, StudioDefinition> = {
  scene: { label: '场景卡', description: '逐场安排、写作和修改；锁定满意的场景，按顺序合成草稿。',
    prompt: '请先读取写作工坊和章节计划，按我的要求拆分或完善场景卡。只规划时不要写正文；需要写某场时先读取邻接场景，保持锁定场景不变。用 propose_writing_card 保存待采纳建议。', fields: [
      { key: 'viewpoint', label: '视角人物', limit: 160 }, { key: 'place', label: '时间与地点', limit: 240 },
      { key: 'goal', label: '场景目标', limit: 800, required: true }, { key: 'conflict', label: '冲突', limit: 800 },
      { key: 'turn', label: '转折', limit: 800 }, { key: 'ending', label: '收尾与下一场衔接', limit: 800 },
      { key: 'targetWords', label: '预计字数', limit: 5 }, { key: 'prose', label: '场景正文', limit: 12000 },
    ] },
  voice: { label: '人物说话档案', description: '从原文对白整理表达习惯，可按交流对象分别保存。',
    prompt: '请读取写作工坊，按我的要求查找并逐段核对原文对白，整理人物对不同对象的说话习惯。区分观察与推测，附逐字引文和来源版本，用 propose_writing_card 保存人物说话档案建议。', fields: [
      { key: 'character', label: '人物', limit: 160, required: true }, { key: 'audience', label: '面对谁', limit: 240 },
      { key: 'diction', label: '用词与称呼', limit: 1000, required: true }, { key: 'rhythm', label: '句式与节奏', limit: 800 },
      { key: 'emotion', label: '情绪表达方式', limit: 1000 }, { key: 'boundaries', label: '不符合人物的说法', limit: 800 },
    ] },
  reading: { label: '模拟试读', description: '按指定阅读角度标注具体段落；反馈是模拟编辑意见。',
    prompt: '请先查阅我指定的草稿或场景，再从指定阅读角度模拟试读，关注疑问、信息密度、情绪中断、章末期待和场景衔接。每个发现独立保存为 reading 建议，附原文逐字引句与版本；说明这是模拟意见，不代表真实读者。', fields: [
      { key: 'perspective', label: '试读角度', limit: 400, required: true }, { key: 'reaction', label: '阅读感受与期待', limit: 1400, required: true },
      { key: 'suggestion', label: '可尝试的调整', limit: 1800 },
    ] },
  knowledge: { label: '角色知情表', description: '分别记录角色掌握、怀疑、误信和未知的信息，保留获知来源。',
    prompt: '请读取写作工坊并回查原文，按角色分别整理知情表，区分已知、怀疑、误信、未知。没有提及不等于明确不知道；证据不足时标为待定。未来揭示属于计划，附来源引文后用 propose_writing_card 保存建议。', fields: [
      { key: 'character', label: '人物', limit: 160, required: true }, { key: 'information', label: '秘密或关键信息', limit: 1200, required: true },
      { key: 'state', label: '认知状态', limit: 20, required: true, options: ['已知', '怀疑', '误信', '未知', '待定'] },
      { key: 'learnedAt', label: '如何、何时获知或形成误会', limit: 1000 }, { key: 'constraint', label: '后续揭示安排', limit: 1000 },
    ] },
  relationship: { label: '关系推进计划', description: '安排关系变化所需的事件，也允许误解、反复与退步。',
    prompt: '请读取写作工坊，结合原文关系和我的目标，安排关系推进所需的事件、未解矛盾与关联场景。当前状态与未来计划分开写，不把计划当成已发生事实；用 propose_writing_card 保存建议。', fields: [
      { key: 'people', label: '涉及人物', limit: 240, required: true }, { key: 'current', label: '当前关系', limit: 1000, required: true },
      { key: 'target', label: '希望发生的变化', limit: 1000 }, { key: 'milestones', label: '推进事件与关联场景（逐行填写）', limit: 2400, required: true },
      { key: 'unresolved', label: '未解矛盾、反复与退步', limit: 1400 },
    ] },
  preference: { label: '改稿偏好', description: '从已经采纳的改动整理偏好；确认后用于本书或个人创作。',
    prompt: '请调用 read_writing_edits 查阅我已经采纳的改稿对照，找出至少两次独立改动中重复出现的写法偏好。引用修改前后原句，说明适用范围和例外，用 propose_writing_card 保存 preference 候选；不足两次时说明证据不足，不把单次修改推断成长期习惯。', fields: [
      { key: 'rule', label: '写作偏好', limit: 1600, required: true }, { key: 'appliesTo', label: '适用情境', limit: 1000, required: true },
      { key: 'exceptions', label: '例外与限制', limit: 1000 },
    ] },
}
export interface StudioEvidence {
  kind: 'chapter' | 'draft' | 'scene' | 'edit'
  id: string
  revision: string
  quote: string
  beforeQuote?: string
}
export interface StudioCardInput {
  kind: StudioKind
  title: string
  scope: StudioScope
  values: Record<string, string>
  evidence: StudioEvidence[]
  position: number
}
export interface StudioCard extends StudioCardInput {
  id: string
  revision: number
  status: 'proposed' | 'active' | 'archived'
  locked: boolean
  origin: 'author' | 'assistant'
  replaces?: { id: string; revision: number }
  createdAt: number
  updatedAt: number
  stale?: boolean
}
export interface StudioSnapshot { cards: StudioCard[]; omitted: string[] }
export interface StudioState { cards: StudioCard[]; contextOmitted: string[] }
export interface StudioVersion { revision: number; card: StudioCard; createdAt: number }
export const studioScope = (kind: StudioKind): StudioScope => ['scene', 'reading'].includes(kind) ? 'session' : 'book'
export const studioBlank = (kind: StudioKind): StudioCardInput => ({ kind, title: '', scope: studioScope(kind),
  values: Object.fromEntries(STUDIO_DEFINITIONS[kind].fields.map(f => [f.key, f.options?.[0] || ''])), evidence: [], position: 0 })
