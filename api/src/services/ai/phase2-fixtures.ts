import type { WritingBriefV1 } from './writing'

/**
 * B6 固定夹具只包含仓库自写的短文本和预先声明的调用预算。
 * 它们不携带生产小说、账号数据或模型输出，测试也不会触发上游请求。
 */
export interface Phase2WritingFixture {
  id: string
  label: string
  seed: string
  context: string
  chapterCount: number
  writingBrief: WritingBriefV1
  expectedProviderCalls: { text: number; image: number }
}

export interface Phase2CoverFixture {
  id: string
  label: string
  title: string
  author: string
  prompt: string
  promptMode: 'auto' | 'exact'
  renderTitle: boolean
  stylePreset: string
  composition: string
  expectedProviderCalls: { text: number; image: number }
}

export const PHASE2_WRITING_FIXTURES: readonly Phase2WritingFixture[] = [
  {
    id: 'writing-history-anchor',
    label: '历史起点',
    seed: '沈砚在旧码头收起断裂的铜哨，答应天亮前把证物交给巡夜人。',
    context: '起点后的第一句必须承接旧码头、铜哨和天亮前的期限，不引入新的城市或叙述者。',
    chapterCount: 1,
    writingBrief: {
      version: 1,
      viewpoint: '第三人称限知，跟随沈砚',
      pace: '短句推进，保留克制的悬疑停顿',
      objective: '让沈砚在离开码头前做出一次可追踪的选择',
      requiredFacts: '铜哨是证物；巡夜人会在天亮前等候；沈砚不认识码头外的陌生人',
      forbiddenEvents: '不要揭示幕后主使；不要让证物凭空消失；不要跳到天亮以后',
      chapterGoals: [{ index: 1, goal: '沈砚避开一次盘问，并留下可以回收的线索。' }],
    },
    expectedProviderCalls: { text: 1, image: 0 },
  },
  {
    id: 'writing-long-tail',
    label: '长章末尾',
    seed: '雨声压过屋檐，林遥读完七页航海日志，最后一行只写着“不要相信返航日”。',
    context: '正文尾部包含连续的环境描写和一条未解释的日志警告，续写需从阅读后的即时反应开始。',
    chapterCount: 1,
    writingBrief: {
      version: 1,
      viewpoint: '第三人称近距离，保持林遥的感知范围',
      pace: '先慢后快，三段内出现行动',
      objective: '把日志警告转化成林遥眼前的具体风险',
      requiredFacts: '日志来自失踪的船队；返航日尚未到；窗外仍在下雨',
      forbiddenEvents: '不要直接解释失踪真相；不要让林遥离开屋子；不要新增超自然能力',
      chapterGoals: [{ index: 1, goal: '林遥确认门外有人，并决定是否回应。' }],
    },
    expectedProviderCalls: { text: 1, image: 0 },
  },
  {
    id: 'writing-multi-relations',
    label: '多人关系',
    seed: '顾棠把药瓶推给季衡，季衡却先看向站在门边的阿芙，三个人谁也没有碰它。',
    context: '三人之间存在互相隐瞒与欠债关系，续写必须让动作体现关系差异。',
    chapterCount: 1,
    writingBrief: {
      version: 1,
      viewpoint: '第三人称全知但不替人物下结论',
      pace: '对话少而有动作，保持压抑的室内节奏',
      objective: '让三人围绕药瓶交换一次不完整的信息',
      requiredFacts: '顾棠掌握药瓶来源；季衡欠阿芙一个解释；阿芙暂时不能离开',
      forbiddenEvents: '不要让三人立刻和解；不要让药瓶被喝下；不要新增第四个核心人物',
      chapterGoals: [{ index: 1, goal: '阿芙提出一个迫使季衡表态的问题。' }],
    },
    expectedProviderCalls: { text: 1, image: 0 },
  },
  {
    id: 'writing-timeline',
    label: '时间线',
    seed: '钟声敲过午后第三下，闻笙才发现信封上的日期比她抵达镇子早了两天。',
    context: '故事当前时间是抵达镇子的当日午后，信封日期早两天但不能证明穿越。',
    chapterCount: 1,
    writingBrief: {
      version: 1,
      viewpoint: '第一人称，闻笙只叙述可确认的观察',
      pace: '冷静核对，结尾留一个可验证的问题',
      objective: '让闻笙寻找日期矛盾的现实证据',
      requiredFacts: '午后第三下钟声已响；闻笙当天抵达；信封没有被拆过',
      forbiddenEvents: '不要改写抵达时间；不要宣布时间循环；不要让日期自动变化',
      chapterGoals: [{ index: 1, goal: '闻笙找到一名能核对钟声记录的人。' }],
    },
    expectedProviderCalls: { text: 1, image: 0 },
  },
  {
    id: 'writing-low-conflict',
    label: '低冲突节奏',
    seed: '清晨的茶摊只来了两位客人，老板把多煮的一壶茶分给他们，街角的猫终于肯靠近火盆。',
    context: '这一段以日常观察为主，没有外部危机；续写应通过细节推进人物关系。',
    chapterCount: 1,
    writingBrief: {
      version: 1,
      viewpoint: '第三人称温和旁观',
      pace: '舒缓，使用感官细节，不强行制造冲突',
      objective: '让两位客人因为一件小事建立可延续的默契',
      requiredFacts: '茶摊在清晨营业；多煮的茶已经分出；猫靠近火盆',
      forbiddenEvents: '不要打斗、追逐或突发灾难；不要跳过清晨；不要把猫写成会说话',
      chapterGoals: [{ index: 1, goal: '两位客人为猫留下一处新的避雨位置。' }],
    },
    expectedProviderCalls: { text: 1, image: 0 },
  },
  {
    id: 'writing-multi-chapter-goals',
    label: '多章目标',
    seed: '祁舟在废弃车站找到一张没有终点的车票，背面印着他童年住过的院门。',
    context: '批次包含三章；每章只应读取对应目标，车票和院门是全批共享事实。',
    chapterCount: 3,
    writingBrief: {
      version: 1,
      viewpoint: '第三人称限知，跟随祁舟',
      pace: '第一章探索，第二章核对，第三章做出取舍',
      objective: '围绕车票追查院门图案的来源',
      requiredFacts: '车票没有终点；院门属于祁舟童年住所；车站已经废弃',
      forbiddenEvents: '不要在第一章揭开全部身世；不要让车站恢复运营；不要改变车票材质',
      chapterGoals: [
        { index: 1, goal: '祁舟在站内找到一处与院门图案相同的刻痕。' },
        { index: 2, goal: '祁舟向旧邻居核对刻痕出现的时间。' },
        { index: 3, goal: '祁舟决定带着车票回到院门前。' },
      ],
    },
    expectedProviderCalls: { text: 3, image: 0 },
  },
]

export const PHASE2_COVER_FIXTURES: readonly Phase2CoverFixture[] = [
  {
    id: 'cover-title-layer',
    label: '渲染书名文字层',
    title: '雨巷拾光',
    author: '林下客',
    prompt: '雨夜青石巷，暖色灯笼与远处伞影，中央留出清晰安全区。',
    promptMode: 'auto',
    renderTitle: true,
    stylePreset: 'soft_watercolor',
    composition: 'environment',
    expectedProviderCalls: { text: 1, image: 1 },
  },
  {
    id: 'cover-exact-prompt',
    label: '完整描述词',
    title: '潮汐信笺',
    author: '南枝',
    prompt: '冷蓝海面、折起的信笺、低饱和银灰云层，留白克制，禁止额外文字。',
    promptMode: 'exact',
    renderTitle: false,
    stylePreset: 'moonlit_dream',
    composition: 'symbolic',
    expectedProviderCalls: { text: 0, image: 1 },
  },
  {
    id: 'cover-duo-relationship',
    label: '双人物关系构图',
    title: '借月',
    author: '闻舟',
    prompt: '两位人物隔着半开的木窗对望，暖冷光交界，保留人物手部和视线关系。',
    promptMode: 'auto',
    renderTitle: true,
    stylePreset: 'romance_illustration',
    composition: 'duo',
    expectedProviderCalls: { text: 1, image: 1 },
  },
  {
    id: 'cover-environment',
    label: '环境叙事构图',
    title: '山河旧梦',
    author: '青简',
    prompt: '黄昏山城与长桥，远景层叠，人物只作小比例剪影，画面保留纵深。',
    promptMode: 'auto',
    renderTitle: true,
    stylePreset: 'ancient_guochao',
    composition: 'environment',
    expectedProviderCalls: { text: 1, image: 1 },
  },
  {
    id: 'cover-symbolic-object',
    label: '关键物件构图',
    title: '铜哨与潮声',
    author: '沈砚',
    prompt: '旧铜哨放在潮湿木桌上，窗外海雾漫入，单一焦点，低噪电影光。',
    promptMode: 'auto',
    renderTitle: false,
    stylePreset: 'dark_cinematic',
    composition: 'symbolic',
    expectedProviderCalls: { text: 1, image: 1 },
  },
  {
    id: 'cover-long-prompt',
    label: '长描述词编辑',
    title: '未寄出的春信',
    author: '纸上风',
    prompt: '浅杏与雾紫的春日室内，旧木窗、摊开的信纸、玻璃杯中的白花、桌面细小水痕、柔和侧光、低对比纸张肌理、人物不露脸、书名区域保持完整留白、边缘不放置额外文字、整体安静而有未说出口的情绪。',
    promptMode: 'exact',
    renderTitle: false,
    stylePreset: 'pastel_romance',
    composition: 'off_center',
    expectedProviderCalls: { text: 0, image: 1 },
  },
]

export function phase2FixtureBudget() {
  return {
    writing: PHASE2_WRITING_FIXTURES.reduce(
      (total, fixture) => ({ text: total.text + fixture.expectedProviderCalls.text, image: total.image + fixture.expectedProviderCalls.image }),
      { text: 0, image: 0 },
    ),
    cover: PHASE2_COVER_FIXTURES.reduce(
      (total, fixture) => ({ text: total.text + fixture.expectedProviderCalls.text, image: total.image + fixture.expectedProviderCalls.image }),
      { text: 0, image: 0 },
    ),
  }
}
