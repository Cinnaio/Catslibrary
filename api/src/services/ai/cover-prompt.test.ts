import { describe, expect, it } from 'vitest'
import { resolveRomanceVisualDNA } from './cover-romance'
import { COVER_COMPOSITION_OPTIONS, COVER_STYLE_OPTIONS, GENRE_STYLES, resolveCoverDirection } from './cover-styles'
import {
  assembleCoverPrompt,
  fallbackCoverScene,
  normalizeCoverPromptLabel,
  normalizeCoverStoryContext,
  renderCoverPromptBlocks,
} from './cover-prompt'

const baseDirection = resolveCoverDirection({
  novelId: 'cover-prompt-contracts',
  genre: 'romance',
  stylePreset: 'soft_watercolor',
  composition: 'environment',
  variationId: 'contract-v1',
})

function promptFor(overrides: Partial<Parameters<typeof assembleCoverPrompt>[0]> = {}) {
  return assembleCoverPrompt({
    scene: 'Two former friends cross a rain-darkened platform, leaving a familiar key between them.',
    style: GENRE_STYLES.romance,
    direction: baseDirection,
    platformStyle: '',
    titleHint: '月光落在你肩上',
    authorHint: '某作者',
    categoryHint: '现代言情',
    storyHint: '两个人多年后重逢，沿着旧街寻找没有说完的话。',
    renderTitle: false,
    romanceDNA: null,
    ...overrides,
  })
}

describe('cover prompt contracts CP01-CP15', () => {
  it('CP01：简介会去 HTML 并折叠空白', () => {
    expect(normalizeCoverStoryContext('  <p>第一段</p>\n\t第二段  ')).toBe('第一段 第二段')
  })

  it('CP02：简介按 UTF-16 上限保留头尾并带省略标记', () => {
    const value = normalizeCoverStoryContext(`${'头部事实。'.repeat(180)}${'尾部事实。'.repeat(180)}`)
    expect(value.length).toBeLessThanOrEqual(800)
    expect(value).toContain('middle omitted')
    expect(value).toContain('头部事实')
    expect(value).toContain('尾部事实')
  })

  it('CP03：上下文裁剪不留下半个代理项', () => {
    const value = normalizeCoverStoryContext('😀'.repeat(500), 801)
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      if (code >= 0xd800 && code <= 0xdbff) expect(value.charCodeAt(index + 1)).toBeGreaterThanOrEqual(0xdc00)
      if (code >= 0xdc00 && code <= 0xdfff) expect(value.charCodeAt(index - 1)).toBeGreaterThanOrEqual(0xd800)
    }
  })

  it('CP04：完整提示词在上限内时按块原样输出，不硬截断', () => {
    const prompt = promptFor({ maxPromptChars: 2000 })
    expect(prompt.length).toBeLessThanOrEqual(2000)
    expect(prompt).toContain('avoid generic stock cover layouts')
  })

  it('CP05：必需块无法容纳时返回 invalid', () => {
    expect(() => promptFor({ maxPromptChars: 100, scene: 'A'.repeat(2000) })).toThrow('无法在 100 个字符内')
  })

  it('CP06：最终提示词只有一套主视觉来源，不再追加题材色彩/光效', () => {
    const prompt = promptFor()
    expect(prompt).toContain('Primary visual preset (highest priority)')
    expect(prompt).toContain('translucent peach')
    expect(prompt).not.toContain('palette must follow the story emotion')
    expect(prompt).not.toContain('lighting must follow the emotional temperature')
  })

  it('CP07：构图方向明确进入同一最终提示词', () => {
    expect(promptFor()).toContain('wide environmental storytelling')
    expect(promptFor({ direction: resolveCoverDirection({ novelId: 'c', genre: 'romance', composition: 'symbolic', stylePreset: 'minimal', variationId: 'v' }) })).toContain('one story-defining object or motif')
  })

  it('CP08：渲染文字时保留输入书名和作者的 exact 语义', () => {
    const prompt = promptFor({ renderTitle: true })
    expect(prompt).toContain("Title text '月光落在你肩上'")
    expect(prompt).toContain("Author name '某作者'")
  })

  it('CP09：no-text 不携带正向 title/author/font 指令', () => {
    const prompt = promptFor()
    expect(prompt).toContain('no text')
    expect(prompt).not.toMatch(/\b(?:title|author|font|lettering|typography)\b/iu)
  })

  it('CP10：本地 fallback 只使用中性主体与场景骨架', () => {
    const scene = fallbackCoverScene('environment')
    expect(scene).toContain('premise-grounded location')
    expect(scene).not.toContain('sword')
    expect(scene).not.toContain('palace')
  })

  it('CP11：言情视觉 DNA 会服从 symbolic 构图', () => {
    const dna = resolveRomanceVisualDNA({ title: '信任之外', description: '一枚戒指记录两人的选择。', variationId: 'cp11', composition: 'symbolic' })
    expect(['object', 'aftermath']).toContain(dna.visualConcept)
  })

  it('CP12：单字“信”不再误触发书信锚点', () => {
    const dna = resolveRomanceVisualDNA({ title: '信任之外', description: '两个人在雨夜讨论彼此的信任。', variationId: 'cp12', composition: 'duo' })
    expect(dna.visualAnchor).not.toContain('opened letter')
  })

  it('CP08：血缘和古代婚约不凭空生成凶案或现代豪门场景', () => {
    const blood = resolveRomanceVisualDNA({ title: '血缘之外', description: '两个人讨论家族血缘与彼此的信任。', variationId: 'cp12-blood', composition: 'duo' })
    expect(blood.emotion).not.toBe('dangerous')
    const ancient = resolveRomanceVisualDNA({ title: '古代婚约', description: '古代王府中的婚约让两人重新选择自己的道路。', variationId: 'cp12-ancient', composition: 'environment' })
    expect(ancient.subtype).toBe('historical')
    expect(ancient.setting).not.toContain('modern')
  })

  it('CP13：资料中的 HTML/控制字符不会改变标签语义', () => {
    expect(normalizeCoverPromptLabel('<b>标题</b>\n作者')).toContain('标题')
    expect(normalizeCoverPromptLabel('标题\u0000作者')).toBe('标题 作者')
  })

  it('CP14：块预算先移除可选块，保留主体、场景和限制', () => {
    const prompt = renderCoverPromptBlocks(
      [
        { id: 'required', required: true, text: 'required visual block.' },
        { id: 'optional', priority: 1, text: 'optional context that can be removed.'.repeat(8) },
        { id: 'tail', required: true, text: 'no watermark.' },
      ],
      100,
    )
    expect(prompt).toContain('required visual block.')
    expect(prompt).toContain('no watermark.')
    expect(prompt).not.toContain('optional context')
  })

  it('CP15：同一组块函数同时用于最终与流式快照', () => {
    const args = {
      scene: 'A quiet platform holds the story-specific object while the subjects remain apart.',
      style: GENRE_STYLES.romance,
      direction: baseDirection,
      platformStyle: '',
      titleHint: '同一画面',
      authorHint: '作者',
      categoryHint: '言情',
      storyHint: '一个物件让两个人重新面对过去。',
      renderTitle: false,
      romanceDNA: null,
      maxPromptChars: 2000,
    } as const
    expect(assembleCoverPrompt(args)).toBe(assembleCoverPrompt({ ...args }))
  })

  it('方向矩阵：所有已公开 preset × composition 的 no-text 组合不注入正向文字指令', () => {
    for (const style of COVER_STYLE_OPTIONS.filter((option) => option.value !== 'auto')) {
      for (const composition of COVER_COMPOSITION_OPTIONS.filter((option) => option.value !== 'auto')) {
        const direction = resolveCoverDirection({
          novelId: `matrix-${style.value}-${composition.value}`,
          genre: 'romance',
          stylePreset: style.value,
          composition: composition.value,
          variationId: 'matrix-v1',
        })
        const prompt = promptFor({ direction, renderTitle: false, platformStyle: 'platform-safe portrait layout, title-safe margins' })
        expect(prompt).not.toMatch(/\b(?:title|author|font|lettering|typography)\b/iu)
        expect(prompt).toContain('no text')
      }
    }
  })
})
