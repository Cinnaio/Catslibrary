import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildImagePrompt } from './cover'
import { compileWritingPrompt, type WritingPromptCompilerOptions } from './writing-prompt'
import { cleanWritingText, formatWritingBrief, type WritingBriefV1 } from './writing'

const textEnvKeys = ['AI_TEXT_BASE_URL', 'AI_TEXT_API_KEY', 'AI_TEXT_MODEL'] as const
const savedEnv = new Map<string, string | undefined>()

const brief: WritingBriefV1 = {
  version: 1,
  viewpoint: '第三人称限知',
  pace: '克制紧凑',
  objective: '推进当前矛盾',
  requiredFacts: '保留已确认事实',
  forbiddenEvents: '本章不得提前揭露真相',
  chapterGoals: [{ index: 1, goal: '留下一个可追查的线索' }],
}

type ComparisonWritingOptions = Omit<WritingPromptCompilerOptions, 'writingSystemPrompt'>

function legacyWritingMessages(opts: ComparisonWritingOptions): { system: string; user: string } {
  const baseSystem = opts.kind === 'write_outline'
    ? '你是中文网络小说策划编辑。请输出可执行的章节大纲，包含主线冲突、人物目标、关键转折和章节安排。只输出内容，不要解释。'
    : '管理员写作指导：保持可读中文。'
  const systemParts = [baseSystem]
  if (opts.kind === 'continue' || opts.kind === 'write_chapter') {
    systemParts.push('本次请求只能创作一章。只在开头输出一次章节标题，正文中不得出现下一章、上一章或任何额外章节标题；写完本章立即停止。')
  }
  if (opts.styleProfile) systemParts.push(`本作风格特征（续写须严格遵循）：\n${opts.styleProfile}`)
  if (opts.relationshipProfile) systemParts.push(`本作角色关系动态（续写须保持人设与权力结构一致，不得逾越关系边界）：\n${opts.relationshipProfile}`)
  const optionInstructions = [
    opts.targetWords ? `Target length: approximately ${Math.max(300, Math.min(30000, Math.trunc(opts.targetWords)))} Chinese characters.` : '',
    opts.chapterCount && opts.chapterCount > 1 ? `Continuation chapter count: ${Math.max(1, Math.min(20, Math.trunc(opts.chapterCount)))} chapters.` : '',
    opts.kind === 'continue' || opts.kind === 'write_chapter' ? '本次仅生成一章；不得继续输出下一章或额外章节标题。' : '',
  ].filter(Boolean)
  const briefParts = formatWritingBrief(opts.writingBrief, 1)
  const legacyContext = [
    opts.context,
    ...(opts.batchDrafts || []).map((draft) => `第 ${draft.index} 章续写：\n${cleanWritingText(draft.text, 6000)}`),
  ].filter(Boolean).join('\n\n')
  return {
    system: systemParts.join('\n\n'),
    user: [
      ...optionInstructions,
      `作品：《${opts.title || '未命名作品'}》`,
      briefParts.structured,
      briefParts.goal,
      opts.instruction ? `补充创作要求：${opts.instruction}` : '',
      opts.outline ? `大纲：\n${cleanWritingText(opts.outline)}` : '',
      opts.plotState?.state ? `本作情节状态（续写须保持人设与伏笔一致）：\n${opts.plotState.state}` : '',
      legacyContext ? `已有剧情上下文：\n${cleanWritingText(legacyContext)}` : '',
    ].filter(Boolean).join('\n\n'),
  }
}

function preview(value: string): string {
  return value.replace(/\s+/gu, ' ').slice(0, 220)
}

describe('R7 prompt architecture comparisons (closed, deterministic fixtures)', () => {
  beforeEach(() => {
    for (const key of textEnvKeys) {
      savedEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of textEnvKeys) {
      const value = savedEnv.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('compares three final cover image payloads without invoking a text or image provider', async () => {
    const cases: Array<{
      id: string
      meta: { title: string; author: string; categories: string[]; description: string }
      options: { novelId: string; stylePreset: string; composition: string; renderTitle: boolean; imageSize: string; variationId: string }
    }> = [
      {
        id: 'cover-airport-reunion',
        meta: { title: '机场重逢', author: '作者', categories: ['悬疑', '现代言情'], description: '两名成年旧识在机场重逢，共同调查一桩失踪案。' },
        options: { novelId: 'cmp-airport', stylePreset: 'soft_watercolor', composition: 'duo', renderTitle: false, imageSize: '1024x1536', variationId: 'comparison-airport' },
      },
      {
        id: 'cover-symbolic-rating-label',
        meta: { title: '夜航之后', author: '作者', categories: ['R18', '象征主义'], description: '一段未说完的告别留在夜色里，城市灯火逐渐熄灭。' },
        options: { novelId: 'cmp-symbolic', stylePreset: 'minimal', composition: 'symbolic', renderTitle: true, imageSize: '1024x1024', variationId: 'comparison-symbolic' },
      },
      {
        id: 'cover-environment-wide-ratio',
        meta: { title: '月面上的春天🙂', author: '长名字作者🙂', categories: ['科幻'], description: '月面基地的温室在尘暴前保持安静，远处的穹顶映着冷光。' },
        options: { novelId: 'cmp-environment', stylePreset: 'graphic_editorial', composition: 'environment', renderTitle: false, imageSize: '1024x1792', variationId: 'comparison-environment' },
      },
    ] as const

    for (const item of cases) {
      const meta = { ...item.meta, categories: [...item.meta.categories] }
      const legacy = await buildImagePrompt(meta, { ...item.options, promptPipelineVersion: 2, maxPromptChars: 2000 })
      const current = await buildImagePrompt(meta, { ...item.options, promptPipelineVersion: 3, maxPromptChars: 2000 })
      const oldPayload = { model: 'mock-image', prompt: legacy.prompt, size: item.options.imageSize, n: 1, quality: 'standard', response_format: 'b64_json' }
      const newPayload = { model: 'mock-image', prompt: current.prompt, size: item.options.imageSize, n: 1, quality: 'standard', response_format: 'b64_json' }
      expect(newPayload.prompt).toBe(current.prompt)
      expect(current.metadata.promptPipelineVersion).toBe(3)
      expect(legacy.metadata.promptPipelineVersion).toBe(2)
      expect(newPayload.prompt).not.toBe(oldPayload.prompt)
      if (item.id === 'cover-symbolic-rating-label') expect(newPayload.prompt).not.toContain('R18')
      if (item.id === 'cover-environment-wide-ratio') expect(newPayload.prompt).toContain('portrait 4:7 ratio')
      console.log(`[${item.id}] ${JSON.stringify({ oldVersion: legacy.metadata.promptPipelineVersion, newVersion: current.metadata.promptPipelineVersion, size: item.options.imageSize, oldLength: oldPayload.prompt.length, newLength: newPayload.prompt.length, oldPreview: preview(oldPayload.prompt), newPreview: preview(newPayload.prompt), calls: { text: 0, image: 0 } })}`)
    }
  })

  it('compares continuation, chapter, and outline final messages against captured legacy assembly', () => {
    const cases: Array<{ id: string; options: ComparisonWritingOptions }> = [
      {
        id: 'writing-continuation',
        options: {
          kind: 'continue' as const,
          title: '雾港调查',
          instruction: '让搭档在雨停前确认线索。',
          context: '已发布正文尾部：门口留下泥脚印。',
          styleProfile: '短句、克制对话、近距离叙述',
          relationshipProfile: '两位调查搭档平等分担风险。',
          plotState: { state: '已确认：脚印来自后门；未解：谁打开了门。', chaptersThrough: 3 },
          writingBrief: brief,
          batchDrafts: [{ index: 1, text: '第一批草稿尾部：门把手有新划痕。' }],
        },
      },
      {
        id: 'writing-chapter',
        options: {
          kind: 'write_chapter' as const,
          title: '雨夜',
          instruction: '写一个含蓄的开场。',
          outline: '第一节：主角在车站发现异常。',
          context: '用户提供的开场背景：末班车即将进站。',
          styleProfile: '白描、少形容词。',
          relationshipProfile: '人物关系尚未确认。',
          writingBrief: brief,
        },
      },
      {
        id: 'writing-outline',
        options: {
          kind: 'write_outline' as const,
          title: '空屋',
          instruction: '列出三章转折，保留悬念。',
          outline: '已有设想：从一把旧钥匙开始。',
          writingBrief: brief,
        },
      },
    ]

    for (const item of cases) {
      const current = compileWritingPrompt({ ...item.options, writingSystemPrompt: '管理员写作指导：保持可读中文。' })
      const legacy = legacyWritingMessages(item.options)
      expect(current.system).not.toContain('本作风格特征（续写须严格遵循）')
      expect(current.user).toContain('CREATIVE_TASK_PIPELINE')
      expect(current.user).not.toBe(legacy.user)
      if (item.options.kind === 'continue') {
        expect(current.user).toContain('batch_draft')
        expect(current.user).not.toContain('第二章')
      }
      if (item.options.kind === 'write_outline') {
        expect(current.system).not.toContain('本次只能生成一章')
        expect(current.user).toContain('不要输出章节正文')
      }
      console.log(`[${item.id}] ${JSON.stringify({ oldLength: legacy.system.length + legacy.user.length, newLength: current.system.length + current.user.length, oldSystemPreview: preview(legacy.system), newSystemPreview: preview(current.system), oldUserPreview: preview(legacy.user), newUserPreview: preview(current.user), calls: { text: 0, image: 0 } })}`)
    }
  })
})
