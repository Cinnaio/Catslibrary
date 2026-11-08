/**
 * 节拍指令（edge）—— 把屏幕当作指令方的一次单人节奏游戏。
 *
 * 本文件只放纯逻辑：设置归一化、随机源、指令池、会话状态机与本机记录存取。
 * 时间推进使用调用方传入的单调时钟读数（`performance.now()`），不读取系统时间；
 * 所有随机都走会话里的种子状态，同一个种子重放会得到同一串指令，便于回归排查。
 */
export type EdgePhase = 'go' | 'slow' | 'stop'
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
}

export const EDGE_HISTORY_LIMIT = 30
export const EDGE_BONUS_PER_EDGE = 5
export const EDGE_BONUS_CAP = 20
/** 加时轮数上限：达到后下一次抽签必然许可，避免无限加时。 */
export const EDGE_OVERTIME_CAP = 5

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
  lottery: { label: '抽签', summary: '按当前许可率决定允许还是禁止；每申报一次忍住，概率 +5%（最多 +20%）' },
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
    overtimeSeconds: integer(input.overtimeSeconds, 15, 300, DEFAULT_EDGE_SETTINGS.overtimeSeconds),
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

function pickPhase(settings: EdgeSettings, previous: EdgePhase, state: number): { phase: EdgePhase; state: number } {
  const weights = EDGE_DIFFICULTIES[settings.difficulty].weights
  const all: Array<[EdgePhase, number]> = [['go', weights.go], ['slow', weights.slow], ['stop', weights.stop]]
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

function segmentDuration(settings: EdgeSettings, phase: EdgePhase, state: number): { durationMs: number; state: number } {
  const [min, max] = EDGE_DIFFICULTIES[settings.difficulty].spanSeconds
  const scale = settings.segmentLength === 'long' ? 2.4 : 1
  const drawn = roll(state)
  const seconds = Math.round(min * scale) + Math.floor(drawn.value * (Math.round(max * scale) - Math.round(min * scale) + 1))
  return { durationMs: seconds * 1000 * (phase === 'stop' ? 0.8 : 1), state: drawn.state }
}

export interface EdgeSession {
  id: string
  settings: EdgeSettings
  status: EdgeStatus
  pauseReason: 'manual' | 'background' | 'interrupted' | null
  /** 前台累计时长，暂停期间不增长。 */
  elapsedMs: number
  /** 整局长度，加时赛会变长。 */
  totalMs: number
  sampledAt: number | null
  phase: EdgePhase
  /** 当前指令（或等待、许可）的结束点，以 elapsedMs 计。 */
  phaseEndsAt: number
  command: string
  bpm: number
  edges: number
  chance: number
  rng: number
  ruined: boolean
  overtime: number
  ending: EdgeEnding | null
}

export type EdgeAction =
  | { type: 'start'; id: string; settings: EdgeSettings; now: number; seed?: number }
  | { type: 'tick'; now: number }
  | { type: 'pause'; now: number; reason: 'manual' | 'background' }
  | { type: 'resume'; now: number }
  | { type: 'edge'; now: number }
  | { type: 'came'; now: number }
  | { type: 'quit'; now: number }
  | { type: 'reset' }

function beginSegment(session: EdgeSession): EdgeSession {
  const phase = pickPhase(session.settings, session.phase, session.rng)
  const command = pickCommand(session.settings, phase.phase, session.command, phase.state)
  const bpm = phaseBpm(phase.phase, command.state)
  const duration = segmentDuration(session.settings, phase.phase, bpm.state)
  return {
    ...session,
    status: 'running',
    phase: phase.phase,
    command: command.command,
    bpm: bpm.bpm,
    phaseEndsAt: session.elapsedMs + duration.durationMs,
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
      const extension = Math.max(session.settings.overtimeSeconds * 1000, 45_000)
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
    if (next.elapsedMs < next.phaseEndsAt) return next
    next = beginSegment(next)
  }
  return next
}

function advance(session: EdgeSession, now: number): EdgeSession {
  if (session.sampledAt === null) return session
  const delta = now - session.sampledAt
  // 设备休眠或主线程长时间阻塞不算这一局的前台时间。
  if (!Number.isFinite(delta) || delta < 0 || delta > 2000) {
    return { ...session, status: 'paused', sampledAt: null, pauseReason: 'interrupted' }
  }
  return resolve({ ...session, elapsedMs: session.elapsedMs + delta, sampledAt: now })
}

export function createEdgeSession(id: string, settings: EdgeSettings, now: number, seed = Date.now() >>> 0): EdgeSession {
  const normalized = normalizeEdgeSettings(settings)
  const base: EdgeSession = {
    id,
    settings: normalized,
    status: 'running',
    pauseReason: null,
    elapsedMs: 0,
    totalMs: normalized.minutes * 60_000,
    sampledAt: now,
    phase: 'stop',
    phaseEndsAt: 0,
    command: '准备好了就开始。手先松着。',
    bpm: 0,
    edges: 0,
    chance: edgeBaseChance(normalized),
    rng: seed >>> 0,
    ruined: false,
    overtime: 0,
    ending: null,
  }
  return beginSegment(base)
}

export function edgeReducer(session: EdgeSession | null, action: EdgeAction): EdgeSession | null {
  if (action.type === 'reset') return session?.status === 'finished' ? null : session
  if (action.type === 'start') {
    if (session && session.status !== 'finished') return session
    return createEdgeSession(action.id, action.settings, action.now, action.seed)
  }
  if (!session || session.status === 'finished') return session
  if (action.type === 'resume') {
    return session.status === 'paused' ? { ...session, status: 'running', sampledAt: action.now, pauseReason: null } : session
  }
  if (action.type === 'pause') {
    const next = advance(session, action.now)
    if (next.status === 'finished' || next.status === 'paused') return next
    return { ...next, status: 'paused', sampledAt: null, pauseReason: action.reason }
  }
  const next = advance(session, action.now)
  if (next.status === 'finished') return next
  if (action.type === 'tick') return next
  if (action.type === 'quit') return finish(next, 'ended')
  if (action.type === 'came') return finish(next, next.status === 'permit' ? (next.ruined ? 'ruined' : 'permitted') : 'lost')
  if (action.type === 'edge') {
    // 红色（不许碰）与等待里没有"申报"这回事；重复按不加分也不重排等待。
    if (next.status !== 'running' || next.phase === 'stop') return next
    const drawn = roll(next.rng)
    const hold = next.settings.holdMin + Math.floor(drawn.value * (next.settings.holdMax - next.settings.holdMin + 1))
    return {
      ...next,
      status: 'cooldown',
      phase: 'stop',
      command: EDGE_COOLDOWN_COMMAND,
      bpm: 0,
      edges: next.edges + 1,
      chance: Math.min(edgeBaseChance(next.settings) + EDGE_BONUS_CAP, next.chance + EDGE_BONUS_PER_EDGE),
      phaseEndsAt: next.elapsedMs + hold * 1000,
      rng: drawn.state,
    }
  }
  return next
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
    })
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
  permitted: number
  longestMs: number
}

export function summarizeEdgeHistory(history: readonly EdgeRecord[]): EdgeTotals {
  return history.reduce<EdgeTotals>(
    (total, record) => ({
      sessions: total.sessions + 1,
      edges: total.edges + record.edges,
      permitted: total.permitted + (record.ending === 'permitted' || record.ending === 'ruined' ? 1 : 0),
      longestMs: Math.max(total.longestMs, record.elapsedMs),
    }),
    { sessions: 0, edges: 0, permitted: 0, longestMs: 0 },
  )
}

export const EDGE_ENDING_LABELS: Record<EdgeEnding, string> = {
  permitted: '拿到许可',
  denied: '被禁止',
  ruined: '松手收场',
  lost: '中途结束',
  ended: '主动退出',
}
