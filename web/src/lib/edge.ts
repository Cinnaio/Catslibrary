/**
 * 节拍指令（edge）—— 把屏幕当作指令方的一次单人节奏游戏。
 *
 * 本文件只放纯逻辑：设置归一化、随机源、指令池、会话状态机与本机记录存取。
 * 时间推进使用调用方传入的单调时钟读数（`performance.now()`），不读取系统时间；
 * 所有随机都走会话里的种子状态，同一个种子重放会得到同一串指令，便于回归排查。
 */
export type EdgePhase = 'go' | 'slow' | 'stop'
/** 三点定位：申报时落在当前指令的哪个位置，越靠后越贵也越值。 */
export type EdgeTiming = 'early' | 'steady' | 'late'
export type EdgeSpendKind = 'pardon' | 'time' | 'permit'
/** 整局三幕：铺垫、折磨、极限。 */
export type EdgeAct = 'warmup' | 'grind' | 'limit'
/** 申报档位：停手（稳、便宜）／磨着不停（贵、冷却翻倍）。 */
export type EdgeDeclare = 'hold' | 'grind'
export type EdgeDifficulty = 'easy' | 'normal' | 'hard' | 'oni'
export type EdgeFinale = 'lottery' | 'always' | 'never' | 'ruin' | 'overtime'
export type EdgeTone = 'gentle' | 'firm' | 'harsh'
export type EdgeCategory = 'tease' | 'pose' | 'pain' | 'edge'
/** running / paused 为正常游玩；cooldown 是申报忍住后的等待；permit 是许可窗口。 */
export type EdgeStatus = 'running' | 'paused' | 'cooldown' | 'permit' | 'finished'
export type EdgeEnding = 'permitted' | 'denied' | 'ruined' | 'lost' | 'ended'
export type EdgeSegmentLength = 'standard' | 'long'

export interface EdgeSettings {
  /** 整局时长（分钟）。 */
  minutes: number
  difficulty: EdgeDifficulty
  finale: EdgeFinale
  /** 允许之后的窗口长度（秒）。 */
  permitSeconds: number
  /** 加时赛单次加时长度（秒）。 */
  overtimeSeconds: number
  sound: boolean
  speech: boolean
  heartbeat: boolean
  tone: EdgeTone
  categories: Record<EdgeCategory, boolean>
  segmentLength: EdgeSegmentLength
  hiddenRemaining: boolean
  /** 自定义许可概率（0–100）；null 表示跟随难度。 */
  customChance: number | null
  /** 申报忍住之后的等待区间（秒）。 */
  holdMin: number
  holdMax: number
  /** 三幕结构：铺垫／折磨／极限，最后一段全红冲刺。 */
  acts: boolean
  /** 时间银行：守住的时间可以攒起来兑现。 */
  bank: boolean
  /** 申报时机判定：越接近指令末尾给得越多。 */
  timing: boolean
}

export const EDGE_HISTORY_LIMIT = 30
export const EDGE_BONUS_PER_EDGE = 5
export const EDGE_BONUS_CAP = 20
/** 加时轮数上限：达到后下一次抽签必然许可，避免无限加时。 */
export const EDGE_OVERTIME_CAP = 5
export const EDGE_OVERTIME_MIN_SECONDS = 45
export const EDGE_OVERTIME_MAX_SECONDS = 300
/** 最后一段全红冲刺的长度；短局按比例缩小，交给 edgeSprintMs 计算。 */
export const EDGE_SPRINT_MS = 30_000
/** 时间银行：每守住这么久存 1 点。 */
export const EDGE_BANK_WINDOW_MS = 60_000
/** 兑现「缩短本局」一次减掉的时间。 */
export const EDGE_BANK_TIME_MS = 30_000
/** 时间银行的兑现价格。 */
export const EDGE_BANK_COST: Record<EdgeSpendKind, number> = { pardon: 3, time: 5, permit: 8 }
/** 三幕的相位权重缩放：铺垫很少红，极限把红翻倍。 */
const ACT_PHASE_SCALE: Record<EdgeAct, Record<EdgePhase, number>> = {
  warmup: { go: 1.3, slow: 1, stop: 0.35 },
  grind: { go: 1, slow: 1, stop: 1 },
  limit: { go: 0.9, slow: 1.1, stop: 2.2 },
}
/** 三幕的段长缩放：铺垫拖长，极限切快。 */
const ACT_SPAN_SCALE: Record<EdgeAct, number> = { warmup: 1.2, grind: 1, limit: 0.7 }
/** 申报得分：停手稳、磨着不停贵，越接近相位末尾给得越多。 */
const DECLARE_BONUS: Record<EdgeDeclare, Record<EdgeTiming, number>> = {
  hold: { early: 1, steady: 3, late: 5 },
  grind: { early: 2, steady: 6, late: 10 },
}
/** 磨着不停的代价：等待翻倍。 */
const DECLARE_COOLDOWN_SCALE: Record<EdgeDeclare, number> = { hold: 1, grind: 1.8 }
/** 靠近指令末尾的判定阈值（占当前指令进度的比例）。 */
const TIMING_THRESHOLDS: readonly [number, number] = [0.34, 0.72]

export const EDGE_SPRINT_COMMAND = '最后一段。手放下，不许碰。'

export const EDGE_TIMING_HINTS: Record<EdgeTiming, string> = {
  early: '现在按太早了，得分很低。',
  steady: '还可以再撑一会儿。',
  late: '就是现在，按下去最值。',
}

export const EDGE_RULE_LABELS = {
  acts: { label: '三幕结构', summary: '铺垫、折磨、极限依次推进，最后一段全红冲刺' },
  bank: { label: '时间银行', summary: '绿色、黄色阶段每累计一分钟存 1 点，可兑现豁免、缩短或许可' },
  timing: { label: '申报时机判定', summary: '按本条指令进度增加许可率，同时开放「磨着不停」；关闭后每次固定增加 5%' },
}

export const EDGE_DECLARE_LABELS: Record<EdgeDeclare, { label: string; summary: string }> = {
  hold: { label: '停手', summary: '松手申报，安全，冷却按设定' },
  grind: { label: '磨着不停', summary: '不松手直接申报，得分更高，但冷却接近翻倍' },
}

export const EDGE_SPEND_LABELS: Record<EdgeSpendKind, { label: string; summary: string }> = {
  pardon: { label: '豁免', summary: '结束当前普通红色指令；等待和冲刺期间不可用' },
  time: { label: '缩短', summary: '本局提前三十秒结束' },
  permit: { label: '兑现许可', summary: '不再抽签，直接进入许可窗口' },
}

export const EDGE_ACT_LABELS: Record<EdgeAct, string> = {
  warmup: '铺垫',
  grind: '折磨',
  limit: '极限',
}

export const DEFAULT_EDGE_SETTINGS: EdgeSettings = {
  minutes: 5,
  difficulty: 'easy',
  finale: 'always',
  permitSeconds: 10,
  overtimeSeconds: 60,
  sound: false,
  speech: false,
  heartbeat: false,
  tone: 'firm',
  categories: { tease: true, pose: true, pain: false, edge: true },
  segmentLength: 'standard',
  hiddenRemaining: false,
  customChance: null,
  holdMin: 8,
  holdMax: 16,
  acts: true,
  bank: true,
  timing: true,
}

export interface EdgeDifficultyInfo {
  label: string
  summary: string
  chance: number
  weights: Record<EdgePhase, number>
  spanSeconds: readonly [number, number]
}

export const EDGE_DIFFICULTIES: Record<EdgeDifficulty, EdgeDifficultyInfo> = {
  easy: {
    label: '简单',
    summary: '大部分时间都可以动，红色的等待很短很少。最后的许可率 85%',
    chance: 85,
    weights: { go: 7, slow: 2, stop: 1 },
    spanSeconds: [20, 45],
  },
  normal: {
    label: '普通',
    summary: '六成动手、两成放慢、两成松手。最后的许可率 70%',
    chance: 70,
    weights: { go: 6, slow: 2, stop: 2 },
    spanSeconds: [18, 40],
  },
  hard: {
    label: '困难',
    summary: '指令切得更快，三成时间不许碰。最后的许可率 50%',
    chance: 50,
    weights: { go: 5, slow: 2, stop: 3 },
    spanSeconds: [14, 32],
  },
  oni: {
    label: '地狱',
    summary: '只有三成时间能动，剩下都在等。最后的许可率 30%，只能靠申报加分',
    chance: 30,
    weights: { go: 3, slow: 3, stop: 4 },
    spanSeconds: [12, 26],
  },
}

export const EDGE_FINALES: Record<EdgeFinale, { label: string; summary: string }> = {
  lottery: { label: '抽签', summary: '按当前许可率决定允许还是禁止；申报奖励最多累计 +20%，许可率不超过 100%' },
  always: { label: '必定允许', summary: '时间一到就允许，第一次玩选这个' },
  never: { label: '必定禁止', summary: '不发放许可，时间到了松手收场' },
  ruin: { label: '松手射精', summary: '可以射，但射出的瞬间要松手，不许再碰' },
  overtime: { label: '加时赛', summary: '没抽中就加时，每轮概率 +15%；最多加时 4 轮，之后必定许可' },
}

export const EDGE_TONES: Record<EdgeTone, { label: string; sample: string }> = {
  gentle: { label: '温柔', sample: '慢慢来，我在。' },
  firm: { label: '直接', sample: '照做。别让我说第二遍。' },
  harsh: { label: '强硬', sample: '就这点定力？忍着。' },
}

export const EDGE_CATEGORY_LABELS: Record<EdgeCategory, string> = {
  tease: '挑逗',
  pose: '姿势·羞耻',
  pain: '轻度疼痛',
  edge: '寸止指令',
}

export const EDGE_COOLDOWN_COMMAND = '松手。等它平息。'

interface EdgeCommand {
  text: string
  phase: EdgePhase
  category: 'basic' | EdgeCategory
}

const COMMANDS: readonly EdgeCommand[] = [
  // 可以动
  { phase: 'go', category: 'basic', text: '用平时的速度，跟着拍子，一拍一下。' },
  { phase: 'go', category: 'basic', text: '快一点。快到能听见声音，手别松。' },
  { phase: 'go', category: 'basic', text: '全力，最快，二十秒内别慢下来。' },
  { phase: 'go', category: 'basic', text: '握紧一点，从根部撸到龟头，一下一下。' },
  { phase: 'go', category: 'basic', text: '只用两根手指，沿着柱身往上，别握满。' },
  { phase: 'go', category: 'basic', text: '换不常用的那只手。别扭也继续。' },
  { phase: 'go', category: 'basic', text: '掌心包住龟头转圈，别的地方先不管。' },
  { phase: 'go', category: 'basic', text: '手停在冠状沟，只在那一段上下套。' },
  { phase: 'go', category: 'basic', text: '把手弄湿，从根部挤到顶，再回去。' },
  { phase: 'go', category: 'basic', text: '腰往前顶，手别动，自己往上撞。' },
  { phase: 'go', category: 'basic', text: '数着来，二十下，一下都不能少。' },
  { phase: 'go', category: 'basic', text: '一只手动，另一只手捏着乳头，两个都不许停。' },
  { phase: 'go', category: 'basic', text: '站起来，腿分开，手垂下来再继续。' },
  { phase: 'go', category: 'basic', text: '用指尖描柱身那条筋，描到底再回来。' },
  // 放慢
  { phase: 'slow', category: 'basic', text: '慢下来。慢到你觉得难受。' },
  { phase: 'slow', category: 'basic', text: '松开一点，只用指尖蹭，蹭到发痒再继续。' },
  { phase: 'slow', category: 'basic', text: '只揉根部，慢慢来，别往上。' },
  { phase: 'slow', category: 'basic', text: '掌心贴住不动，只让腰慢慢晃。' },
  { phase: 'slow', category: 'basic', text: '慢得几乎不算动，但手不许离开。' },
  { phase: 'slow', category: 'basic', text: '数着来，数到十再换手。' },
  { phase: 'slow', category: 'basic', text: '把速度降到一半，越慢越好，别偷跑。' },
  { phase: 'slow', category: 'basic', text: '只用手心最软的那块慢慢磨龟头。' },
  // 松手
  { phase: 'stop', category: 'basic', text: '松手。结束前不许碰。' },
  { phase: 'stop', category: 'basic', text: '松手，等它平息。' },
  { phase: 'stop', category: 'basic', text: '松手。三十秒内什么都不准做，再抖也不准碰。' },
  { phase: 'stop', category: 'basic', text: '两只手放到膝盖上，看着屏幕，别动。' },
  { phase: 'stop', category: 'basic', text: '松手，深呼吸三次，再等我开口。' },
  { phase: 'stop', category: 'basic', text: '现在松开。握得越紧，等得越久。' },
  // 挑逗
  { phase: 'stop', category: 'tease', text: '只准碰乳头，手往下伸就算输。' },
  { phase: 'stop', category: 'tease', text: '两只手捏住乳头慢慢转，下面不许碰。' },
  { phase: 'stop', category: 'tease', text: '用指尖弹乳头，一拍一下，弹到发麻。' },
  { phase: 'slow', category: 'tease', text: '一只手揉蛋蛋，另一只手不许动。' },
  { phase: 'stop', category: 'tease', text: '用指腹一圈一圈揉蛋蛋，柱身不许碰。' },
  { phase: 'slow', category: 'tease', text: '把前液抹在乳头上，慢慢揉开。' },
  { phase: 'slow', category: 'tease', text: '大腿内侧慢慢摸，越靠近越要慢，就是不许碰那里。' },
  { phase: 'stop', category: 'tease', text: '张开腿，只许看，不许碰。' },
  // 姿势
  { phase: 'stop', category: 'pose', text: '跪好，背挺直，手放腿上，看着屏幕。' },
  { phase: 'stop', category: 'pose', text: '四肢着地，腰抬高，就这样等。' },
  { phase: 'stop', category: 'pose', text: '躺下，两腿抱起分开，别遮。' },
  { phase: 'stop', category: 'pose', text: '站起来对着镜子，看自己现在的脸。' },
  { phase: 'stop', category: 'pose', text: '把衣服撩到胸口，咬着下摆，别松口。' },
  { phase: 'slow', category: 'pose', text: '手放到身后交叉，胸挺出来，慢慢动腰。' },
  // 轻度疼痛
  { phase: 'stop', category: 'pain', text: '轻轻扇自己两下，别用力，下面不许碰。' },
  { phase: 'stop', category: 'pain', text: '用手掌拍大腿内侧，拍到发热为止。' },
  { phase: 'stop', category: 'pain', text: '捏住蛋蛋慢慢加力，然后松开，再等。' },
  // 寸止
  { phase: 'go', category: 'edge', text: '抬到极限前一步，停，松手。' },
  { phase: 'slow', category: 'edge', text: '在边缘磨十秒，然后松手，看着它跳。' },
  { phase: 'go', category: 'edge', text: '冲到差点出来，立刻松手，手放在腿上。' },
  { phase: 'slow', category: 'edge', text: '只准在边上待着，不许过线。' },
]

const TONE_LINES: Record<EdgeTone, readonly string[]> = {
  gentle: ['慢慢来，我在。', '做得很好，继续。', '不用急，跟着我呼吸。', '缓过来了我们再继续。'],
  firm: ['照做。', '别让我说第二遍。', '手别停。', '现在。', '听到了就动。'],
  harsh: ['就这点定力？', '一副忍不住的样子，真丢人。', '忍着。别让我看见你的手抖。', '再碰一下，今天就到这里。'],
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export function normalizeEdgeSettings(value: unknown): EdgeSettings {
  const input = object(value)
  const categories = object(input.categories)
  const holdMin = integer(input.holdMin, 3, 120, DEFAULT_EDGE_SETTINGS.holdMin)
  return {
    minutes: integer(input.minutes, 1, 180, DEFAULT_EDGE_SETTINGS.minutes),
    difficulty: pick(input.difficulty, ['easy', 'normal', 'hard', 'oni'], DEFAULT_EDGE_SETTINGS.difficulty),
    finale: pick(input.finale, ['lottery', 'always', 'never', 'ruin', 'overtime'], DEFAULT_EDGE_SETTINGS.finale),
    permitSeconds: integer(input.permitSeconds, 5, 60, DEFAULT_EDGE_SETTINGS.permitSeconds),
    overtimeSeconds: integer(input.overtimeSeconds, EDGE_OVERTIME_MIN_SECONDS, EDGE_OVERTIME_MAX_SECONDS, DEFAULT_EDGE_SETTINGS.overtimeSeconds),
    sound: input.sound === true,
    speech: input.speech === true,
    heartbeat: input.heartbeat === true,
    tone: pick(input.tone, ['gentle', 'firm', 'harsh'], DEFAULT_EDGE_SETTINGS.tone),
    categories: {
      tease: categories.tease !== false,
      pose: categories.pose !== false,
      pain: categories.pain === true,
      edge: categories.edge !== false,
    },
    segmentLength: pick(input.segmentLength, ['standard', 'long'], DEFAULT_EDGE_SETTINGS.segmentLength),
    hiddenRemaining: input.hiddenRemaining === true,
    customChance: typeof input.customChance === 'number' && Number.isFinite(input.customChance)
      ? Math.min(100, Math.max(0, Math.round(input.customChance)))
      : null,
    holdMin,
    holdMax: Math.max(holdMin, integer(input.holdMax, 3, 120, DEFAULT_EDGE_SETTINGS.holdMax)),
    acts: input.acts !== false,
    bank: input.bank !== false,
    timing: input.timing !== false,
  }
}

export function edgeBaseChance(settings: EdgeSettings): number {
  return settings.customChance ?? EDGE_DIFFICULTIES[settings.difficulty].chance
}

/** mulberry32：一个整数状态即随机源，可跟随会话保存。 */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0
  let t = Math.imul(next ^ (next >>> 15), 1 | next)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next }
}

function roll(state: number): { value: number; state: number } {
  return nextRandom(state)
}

function phaseEntries(settings: EdgeSettings, act: EdgeAct): Array<[EdgePhase, number]> {
  const weights = EDGE_DIFFICULTIES[settings.difficulty].weights
  const scale = settings.acts ? ACT_PHASE_SCALE[act] : ACT_PHASE_SCALE.grind
  return [['go', weights.go * scale.go], ['slow', weights.slow * scale.slow], ['stop', weights.stop * scale.stop]]
}

function pickPhase(settings: EdgeSettings, act: EdgeAct, previous: EdgePhase, state: number): { phase: EdgePhase; state: number } {
  const all = phaseEntries(settings, act)
  // 同一相位不连续出现，避免整局卡在红色或绿色。
  const allowed = all.filter(([phase]) => phase !== previous)
  const total = allowed.reduce((sum, [, weight]) => sum + weight, 0)
  const drawn = roll(state)
  let threshold = drawn.value * total
  let chosen = allowed[allowed.length - 1]!
  for (const entry of allowed) {
    if (threshold < entry[1]) { chosen = entry; break }
    threshold -= entry[1]
  }
  return { phase: chosen[0], state: drawn.state }
}

function pickCommand(settings: EdgeSettings, phase: EdgePhase, previous: string, state: number): { command: string; state: number } {
  const enabled = COMMANDS.filter((command) => command.phase === phase
    && (command.category === 'basic' || settings.categories[command.category]))
  const pool = enabled.length > 0 ? enabled : COMMANDS.filter((command) => command.phase === phase)
  const index = roll(state)
  let cursor = index.state
  let text = pool[Math.min(pool.length - 1, Math.floor(index.value * pool.length))]!.text
  if (text === previous) text = `${text} 别停。`
  const toneRoll = roll(cursor)
  cursor = toneRoll.state
  if (toneRoll.value >= 0.34) return { command: text, state: cursor }
  const tone = TONE_LINES[settings.tone]
  const lineRoll = roll(cursor)
  cursor = lineRoll.state
  const line = tone[Math.min(tone.length - 1, Math.floor(lineRoll.value * tone.length))]!
  const orderRoll = roll(cursor)
  cursor = orderRoll.state
  return { command: orderRoll.value < 0.5 ? `${line}${text}` : `${text}${line}`, state: cursor }
}

/** 红色只需要提示音停掉，BPM 记 0。 */
function phaseBpm(phase: EdgePhase, state: number): { bpm: number; state: number } {
  if (phase === 'stop') return { bpm: 0, state }
  const drawn = roll(state)
  return { bpm: phase === 'go' ? Math.round(110 + drawn.value * 60) : Math.round(18 + drawn.value * 26), state: drawn.state }
}

/** 三幕按本局进度切分：铺垫 0–30%、折磨 30–75%、极限 75–100%。冲刺段单独算。 */
export function edgeActAt(settings: EdgeSettings, elapsedMs: number, totalMs: number): EdgeAct {
  if (!settings.acts || totalMs <= 0) return 'grind'
  const ratio = Math.min(1, Math.max(0, elapsedMs / totalMs))
  if (ratio < 0.3) return 'warmup'
  if (ratio < 0.75) return 'grind'
  return 'limit'
}

/** 冲刺长度：默认三十秒，最长不超过整局的四分之一。 */
export function edgeSprintMs(totalMs: number): number {
  return Math.min(EDGE_SPRINT_MS, Math.round(totalMs / 4))
}

/** 剩余时间进入冲刺段后返回 true；冲刺段固定全红。 */
export function edgeInSprint(totalMs: number, elapsedMs: number): boolean {
  const sprint = edgeSprintMs(totalMs)
  return sprint > 0 && totalMs - elapsedMs <= sprint
}

function segmentDuration(settings: EdgeSettings, act: EdgeAct, state: number): { durationMs: number; state: number } {
  const [min, max] = EDGE_DIFFICULTIES[settings.difficulty].spanSeconds
  const scale = (settings.segmentLength === 'long' ? 2.4 : 1) * (settings.acts ? ACT_SPAN_SCALE[act] : 1)
  const drawn = roll(state)
  const seconds = Math.round(min * scale) + Math.floor(drawn.value * (Math.round(max * scale) - Math.round(min * scale) + 1))
  // 红色本身已经按权重压过，不再额外缩短；文案与实现对得上。
  return { durationMs: seconds * 1000, state: drawn.state }
}

export interface EdgeSession {
  id: string
  settings: EdgeSettings
  status: EdgeStatus
  resumeStatus: 'running' | 'cooldown' | 'permit' | null
  pauseReason: 'manual' | 'background' | 'interrupted' | null
  /** 前台累计时长，暂停期间不增长。 */
  elapsedMs: number
  /** 整局长度，加时赛会变长。 */
  totalMs: number
  sampledAt: number | null
  phase: EdgePhase
  /** 当前幕，随进度变化；acts 关闭时恒为 grind。 */
  act: EdgeAct
  /** 当前指令的起点与结束点，都以 elapsedMs 计；时机判定用两者算比例。 */
  phaseStartedAt: number
  phaseEndsAt: number
  command: string
  bpm: number
  edges: number
  /** 其中「磨着不停」的申报次数。 */
  grinds: number
  chance: number
  rng: number
  ruined: boolean
  overtime: number
  /** 时间银行已存下的点数与向下一分推进的余量。 */
  bank: number
  bankedMs: number
  /** 已经花掉的点数，用于结算展示。 */
  spent: number
  ending: EdgeEnding | null
}

export type EdgeAction =
  | { type: 'start'; id: string; settings: EdgeSettings; now: number; seed?: number }
  | { type: 'tick'; now: number }
  | { type: 'pause'; now: number; reason: 'manual' | 'background' }
  | { type: 'resume'; now: number }
  | { type: 'edge'; now: number; declare?: EdgeDeclare }
  | { type: 'spend'; kind: EdgeSpendKind; now: number }
  | { type: 'came'; now: number }
  | { type: 'quit'; now: number }
  | { type: 'reset' }
  | { type: 'discard' }

/** 当前指令走了多少；时机判定与 UI 提示共用。 */
export function edgePhaseProgress(session: EdgeSession): number {
  const span = session.phaseEndsAt - session.phaseStartedAt
  if (!(span > 0)) return 0
  return Math.min(1, Math.max(0, (session.elapsedMs - session.phaseStartedAt) / span))
}

/** 申报时机：越接近本条末尾越值钱。timing 关闭时一律按 steady 计。 */
export function edgeTimingAt(session: EdgeSession): EdgeTiming {
  if (!session.settings.timing) return 'steady'
  const progress = edgePhaseProgress(session)
  if (progress < TIMING_THRESHOLDS[0]) return 'early'
  if (progress < TIMING_THRESHOLDS[1]) return 'steady'
  return 'late'
}

/** UI 与 reducer 共用的兑现条件；note 非空表示不能兑现。 */
export function edgeSpendOptions(session: EdgeSession): Array<{ kind: EdgeSpendKind; cost: number; note: string | null }> {
  return (Object.keys(EDGE_BANK_COST) as EdgeSpendKind[]).map((kind) => {
    const cost = EDGE_BANK_COST[kind]
    let note: string | null = null
    if (!session.settings.bank) note = '本局未开启时间银行'
    else if (session.status !== 'running' && session.status !== 'cooldown') note = '这一局现在不能兑现'
    else if (kind === 'pardon' && session.status === 'cooldown') note = '申报后的等待不能豁免'
    else if (kind === 'pardon' && session.settings.acts && edgeInSprint(session.totalMs, session.elapsedMs)) note = '冲刺期间不能豁免'
    else if (kind === 'pardon' && session.phase !== 'stop') note = '只在红色指令里可用'
    else if (kind === 'time' && session.totalMs - session.elapsedMs <= EDGE_BANK_TIME_MS + 5000) note = '剩下的时间不够再缩短'
    else if (session.bank < cost) note = `还差 ${cost - session.bank} 点`
    return { kind, cost, note }
  })
}

/** 原生桥接和 Web 共享提示与可用项，不在各端重写规则。 */
export function edgeSessionFeedback(session: EdgeSession) {
  const timing = session.settings.timing && session.status === 'running' && session.phase !== 'stop'
    ? edgeTimingAt(session) : null
  return {
    timing,
    timingHint: timing ? EDGE_TIMING_HINTS[timing] : null,
    sprinting: session.settings.acts && session.status === 'running' && edgeInSprint(session.totalMs, session.elapsedMs),
    spends: edgeSpendOptions(session),
  }
}

function beginSprint(session: EdgeSession): EdgeSession {
  return {
    ...session,
    status: 'running',
    act: 'limit',
    phase: 'stop',
    command: EDGE_SPRINT_COMMAND,
    bpm: 0,
    phaseStartedAt: session.elapsedMs,
    phaseEndsAt: session.totalMs,
  }
}

function beginSegment(session: EdgeSession): EdgeSession {
  const act = edgeActAt(session.settings, session.elapsedMs, session.totalMs)
  if (session.settings.acts && edgeInSprint(session.totalMs, session.elapsedMs)) return beginSprint(session)
  const phase = pickPhase(session.settings, act, session.phase, session.rng)
  const command = pickCommand(session.settings, phase.phase, session.command, phase.state)
  const bpm = phaseBpm(phase.phase, command.state)
  const duration = segmentDuration(session.settings, act, bpm.state)
  // 冲刺段不能被一条提前开始的指令跨过去：到冲刺起点就切段，保证最后一段必定全红。
  const sprintStart = session.totalMs - edgeSprintMs(session.totalMs)
  const endsAt = Math.min(session.elapsedMs + duration.durationMs, session.settings.acts ? sprintStart : session.totalMs)
  return {
    ...session,
    status: 'running',
    act,
    phase: phase.phase,
    command: command.command,
    bpm: bpm.bpm,
    phaseStartedAt: session.elapsedMs,
    phaseEndsAt: endsAt,
    rng: duration.state,
  }
}

function finish(session: EdgeSession, ending: EdgeEnding): EdgeSession {
  return { ...session, status: 'finished', ending, sampledAt: null, pauseReason: null, bpm: 0 }
}

function startPermit(session: EdgeSession, ruined: boolean): EdgeSession {
  const seconds = session.settings.permitSeconds
  return {
    ...session,
    status: 'permit',
    phase: 'go',
    ruined,
    command: ruined ? '可以射。但射出的瞬间要松手。' : `可以射了。${seconds} 秒内。`,
    bpm: 0,
    phaseStartedAt: session.elapsedMs,
    phaseEndsAt: session.elapsedMs + seconds * 1000,
  }
}

function resolveEnding(session: EdgeSession): EdgeSession {
  const drawn = roll(session.rng)
  const base: EdgeSession = { ...session, rng: drawn.state }
  switch (session.settings.finale) {
    case 'always':
      return startPermit(base, false)
    case 'never':
      return finish(base, 'denied')
    case 'ruin':
      return startPermit(base, true)
    case 'lottery':
      return drawn.value * 100 < session.chance ? startPermit(base, false) : finish(base, 'denied')
    case 'overtime': {
      const boosted = Math.min(100, session.chance + 15 * session.overtime)
      if (drawn.value * 100 < boosted || session.overtime + 1 >= EDGE_OVERTIME_CAP) return startPermit(base, false)
      const overtime = session.overtime + 1
      // 加时至少留出一次完整指令的余地，否则新相位还没走完就又撞上结束点。
      const extension = session.settings.overtimeSeconds * 1000
      return beginSegment({
        ...base,
        overtime,
        chance: boosted,
        totalMs: base.totalMs + extension,
      })
    }
  }
}

/** 单步推进到稳定状态：处理相位结束、等待结束、许可过期与整局结束。 */
function resolve(session: EdgeSession): EdgeSession {
  let next = session
  for (let guard = 0; guard < 32; guard += 1) {
    if (next.status === 'finished' || next.status === 'paused') return next
    if (next.status === 'permit') {
      return next.elapsedMs >= next.phaseEndsAt ? finish(next, next.ruined ? 'ruined' : 'permitted') : next
    }
    // 结束点优先于当前相位，否则最后一条指令可能拖过整局时间。
    if (next.elapsedMs >= next.totalMs) {
      next = resolveEnding(next)
      continue
    }
    const act = edgeActAt(next.settings, next.elapsedMs, next.totalMs)
    if (next.act !== act) next = { ...next, act }
    if (next.status === 'running' && next.settings.acts) {
      const sprintStart = next.totalMs - edgeSprintMs(next.totalMs)
      if (next.elapsedMs >= sprintStart) {
        return next.phase === 'stop' && next.command === EDGE_SPRINT_COMMAND && next.phaseEndsAt === next.totalMs
          ? next : beginSprint(next)
      }
      // 缩短总时长后也重新裁剪当前指令，不能穿过新的冲刺起点。
      if (next.phaseEndsAt > sprintStart) next = { ...next, phaseEndsAt: sprintStart }
    }
    if (next.elapsedMs < next.phaseEndsAt) return next
    next = beginSegment(next)
  }
  return next
}

/** 只累计绿色、黄色阶段；推进过程在相位边界处分段记账。 */
function bankTick(session: EdgeSession, delta: number): EdgeSession {
  if (!session.settings.bank || session.status !== 'running' || session.phase === 'stop') return session
  let bankedMs = session.bankedMs + delta
  let bank = session.bank
  while (bankedMs >= EDGE_BANK_WINDOW_MS) {
    bankedMs -= EDGE_BANK_WINDOW_MS
    bank += 1
  }
  return bankedMs === session.bankedMs && bank === session.bank ? session : { ...session, bankedMs, bank }
}

function advance(session: EdgeSession, now: number): EdgeSession {
  if (session.sampledAt === null) return session
  const delta = now - session.sampledAt
  // 设备休眠或主线程长时间阻塞不算这一局的前台时间。
  if (!Number.isFinite(delta) || delta < 0 || delta > 2000) {
    return { ...session, status: 'paused', resumeStatus: session.status === 'cooldown' || session.status === 'permit' ? session.status : 'running', sampledAt: null, pauseReason: 'interrupted' }
  }
  let next = resolve(session)
  let remaining = delta
  // 每次只推进到下一个边界，避免把跨入红色/许可的时间记入银行。
  while (remaining > 0 && next.status !== 'finished' && next.status !== 'paused') {
    const boundary = next.status === 'permit' ? next.phaseEndsAt : Math.min(next.phaseEndsAt, next.totalMs)
    const step = Math.min(remaining, boundary - next.elapsedMs)
    const banked = bankTick(next, step)
    next = resolve({ ...banked, elapsedMs: banked.elapsedMs + step })
    remaining -= step
  }
  return { ...next, sampledAt: next.status === 'finished' || next.status === 'paused' ? null : now }
}

export function createEdgeSession(id: string, settings: EdgeSettings, now: number, seed = Date.now() >>> 0): EdgeSession {
  const normalized = normalizeEdgeSettings(settings)
  const base: EdgeSession = {
    id,
    settings: normalized,
    status: 'running',
    resumeStatus: null,
    pauseReason: null,
    elapsedMs: 0,
    totalMs: normalized.minutes * 60_000,
    sampledAt: now,
    phase: 'stop',
    act: 'warmup',
    phaseStartedAt: 0,
    phaseEndsAt: 0,
    command: '准备好了就开始。手先松着。',
    bpm: 0,
    edges: 0,
    grinds: 0,
    chance: edgeBaseChance(normalized),
    rng: seed >>> 0,
    ruined: false,
    overtime: 0,
    bank: 0,
    bankedMs: 0,
    spent: 0,
    ending: null,
  }
  return beginSegment(base)
}

export function edgeReducer(session: EdgeSession | null, action: EdgeAction): EdgeSession | null {
  // Lifecycle cleanup is separate from dismissing an already finished result.
  if (action.type === 'discard') return null
  if (action.type === 'reset') return session?.status === 'finished' ? null : session
  if (action.type === 'start') {
    if (session && session.status !== 'finished') return session
    return createEdgeSession(action.id, action.settings, action.now, action.seed)
  }
  if (!session || session.status === 'finished') return session
  if (action.type === 'resume') {
    return session.status === 'paused' ? { ...session, status: session.resumeStatus ?? 'running', resumeStatus: null, sampledAt: action.now, pauseReason: null } : session
  }
  if (action.type === 'pause') {
    const next = advance(session, action.now)
    if (next.status === 'finished' || next.status === 'paused') return next
    return { ...next, status: 'paused', resumeStatus: next.status, sampledAt: null, pauseReason: action.reason }
  }
  const next = advance(session, action.now)
  if (next.status === 'finished') return next
  if (action.type === 'tick') return next
  if (action.type === 'quit') return finish(next, 'ended')
  if (action.type === 'came') return finish(next, next.status === 'permit' ? (next.ruined ? 'ruined' : 'permitted') : 'lost')
  if (action.type === 'spend') return spendBank(next, action.kind)
  if (action.type === 'edge') {
    // 红色（不许碰）与等待里没有"申报"这回事；重复按不加分也不重排等待。
    if (next.status !== 'running' || next.phase === 'stop') return next
    if (!next.settings.timing && action.declare === 'grind') return next
    const declare: EdgeDeclare = action.declare ?? 'hold'
    const timing = edgeTimingAt(next)
    const drawn = roll(next.rng)
    const spread = next.settings.holdMax - next.settings.holdMin + 1
    const baseHold = next.settings.holdMin + Math.floor(drawn.value * spread)
    const hold = Math.round(baseHold * DECLARE_COOLDOWN_SCALE[declare])
    const bonus = next.settings.timing ? DECLARE_BONUS[declare][timing] : EDGE_BONUS_PER_EDGE
    return {
      ...next,
      status: 'cooldown',
      phase: 'stop',
      command: declare === 'grind' ? '磨着申报记下了。松手，等它平息。' : EDGE_COOLDOWN_COMMAND,
      bpm: 0,
      edges: next.edges + 1,
      grinds: next.grinds + (declare === 'grind' ? 1 : 0),
      // 许可率夹在 100 以内，避免高分难度下概率溢出到无意义的数字。
      chance: Math.min(100, Math.min(edgeBaseChance(next.settings) + EDGE_BONUS_CAP, next.chance + bonus)),
      phaseStartedAt: next.elapsedMs,
      phaseEndsAt: next.elapsedMs + hold * 1000,
      rng: drawn.state,
    }
  }
  return next
}

/** 兑现时间银行的点数：豁免红色、缩短本局、或直接换许可。 */
function spendBank(session: EdgeSession, kind: EdgeSpendKind): EdgeSession {
  const option = edgeSpendOptions(session).find((entry) => entry.kind === kind)
  if (!option || option.note !== null) return session
  const paid = { ...session, bank: session.bank - option.cost, spent: session.spent + option.cost }
  if (kind === 'permit') return startPermit(paid, session.settings.finale === 'ruin')
  if (kind === 'time') {
    return resolve({ ...paid, totalMs: paid.totalMs - EDGE_BANK_TIME_MS })
  }
  return beginSegment({ ...paid, status: 'running', phase: 'stop', phaseStartedAt: paid.elapsedMs, phaseEndsAt: paid.elapsedMs })
}

export function formatEdgeTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export interface EdgeRecord {
  id: string
  finishedAt: number
  minutes: number
  difficulty: EdgeDifficulty
  finale: EdgeFinale
  elapsedMs: number
  edges: number
  /** 「磨着不停」的申报次数；旧记录缺省按 0 读。 */
  grinds: number
  /** 花掉的时间银行点数；旧记录缺省按 0 读。 */
  spent: number
  overtime: number
  ending: EdgeEnding
}

export interface EdgeData {
  settings: EdgeSettings
  history: EdgeRecord[]
}

const ENDINGS: readonly EdgeEnding[] = ['permitted', 'denied', 'ruined', 'lost', 'ended']

export function edgeStorageKey(scope: string): string {
  return `zhizhou-edge:v1:${scope}`
}

export function mergeEdgeHistory(...lists: EdgeRecord[][]): EdgeRecord[] {
  return [...new Map(lists.flat().map((record) => [record.id, record])).values()]
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, EDGE_HISTORY_LIMIT)
}

export function readEdgeData(scope: string): { data: EdgeData; error: string | null } {
  const fallback: EdgeData = { settings: { ...DEFAULT_EDGE_SETTINGS }, history: [] }
  try {
    const raw = localStorage.getItem(edgeStorageKey(scope))
    if (!raw) return { data: fallback, error: null }
    const input = object(JSON.parse(raw))
    if (!input.settings || !Array.isArray(input.history)) throw new Error('Invalid edge data')
    const history = input.history.filter((entry: unknown): entry is EdgeRecord => {
      const record = object(entry)
      return typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 100
        && typeof record.finishedAt === 'number' && Number.isFinite(record.finishedAt) && record.finishedAt > 0 && record.finishedAt <= 8.64e15
        && typeof record.minutes === 'number' && Number.isInteger(record.minutes) && record.minutes >= 1 && record.minutes <= 180
        && typeof record.elapsedMs === 'number' && Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0
        && typeof record.edges === 'number' && Number.isInteger(record.edges) && record.edges >= 0 && record.edges <= 999
        && typeof record.overtime === 'number' && Number.isInteger(record.overtime) && record.overtime >= 0 && record.overtime <= 20
        && (ENDINGS as readonly string[]).includes(String(record.ending))
        && typeof record.difficulty === 'string' && record.difficulty in EDGE_DIFFICULTIES
        && typeof record.finale === 'string' && record.finale in EDGE_FINALES
    }).map((record) => ({
      ...record,
      // 这两个字段是后加的，旧记录按 0 补齐而不是整条丢弃。
      grinds: typeof (record as Partial<EdgeRecord>).grinds === 'number' && Number.isInteger(record.grinds) && record.grinds >= 0 && record.grinds <= 999 ? record.grinds : 0,
      spent: typeof (record as Partial<EdgeRecord>).spent === 'number' && Number.isInteger(record.spent) && record.spent >= 0 && record.spent <= 999 ? record.spent : 0,
    }))
    return { data: { settings: normalizeEdgeSettings(input.settings), history: mergeEdgeHistory(history) }, error: null }
  } catch {
    return { data: fallback, error: '暂时无法读取本机设置和记录，当前使用默认设置。' }
  }
}

export function writeEdgeData(scope: string, data: EdgeData): boolean {
  try {
    localStorage.setItem(edgeStorageKey(scope), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export interface EdgeTotals {
  sessions: number
  edges: number
  grinds: number
  spent: number
  permitted: number
  longestMs: number
}

export function summarizeEdgeHistory(history: readonly EdgeRecord[]): EdgeTotals {
  return history.reduce<EdgeTotals>(
    (total, record) => ({
      sessions: total.sessions + 1,
      edges: total.edges + record.edges,
      grinds: total.grinds + (record.grinds ?? 0),
      spent: total.spent + (record.spent ?? 0),
      permitted: total.permitted + (record.ending === 'permitted' || record.ending === 'ruined' ? 1 : 0),
      longestMs: Math.max(total.longestMs, record.elapsedMs),
    }),
    { sessions: 0, edges: 0, grinds: 0, spent: 0, permitted: 0, longestMs: 0 },
  )
}

export const EDGE_ENDING_LABELS: Record<EdgeEnding, string> = {
  permitted: '拿到许可',
  denied: '被禁止',
  ruined: '松手收场',
  lost: '中途结束',
  ended: '主动退出',
}
