import { describe, expect, it } from 'vitest'
import {
  buildRewriteTaskParams,
  detectRewriteContinuation,
  parseRewriteSuggestion,
  parseRewriteTaskParams,
  rewriteContentRevision,
  validateRewriteSelection,
} from './rewrite'

describe('rewrite selection', () => {
  it('uses UTF-16 half-open ranges while preserving emoji and CRLF boundaries', () => {
    const content = '前文🙂。\r\n待改写🌧️选段。\r\n后文。'
    const selectedText = '待改写🌧️选段。'
    const startUTF16 = content.indexOf(selectedText)
    const endUTF16 = startUTF16 + selectedText.length
    const validated = validateRewriteSelection(content, {
      baseRevision: rewriteContentRevision(content),
      startUTF16,
      endUTF16,
      selectedText,
      mode: 'polish',
      instruction: '',
    })

    expect(validated.error).toBeUndefined()
    expect(validated.value?.startUTF16).toBe(startUTF16)
    expect(content.slice(validated.value!.startUTF16, validated.value!.endUTF16)).toBe(selectedText)

    const params = buildRewriteTaskParams('draft-1', content, validated.value!)
    expect(params.contextBefore).toContain('前文🙂。\r\n')
    expect(params.contextAfter).toBe('\r\n后文。')
    expect(parseRewriteTaskParams(params)).toEqual(params)
  })

  it('rejects ranges that split a surrogate pair or no longer match the frozen selection', () => {
    const content = '甲🙂乙'
    const baseRevision = rewriteContentRevision(content)
    expect(validateRewriteSelection(content, {
      baseRevision,
      startUTF16: 2,
      endUTF16: 3,
      selectedText: '�',
      mode: 'polish',
      instruction: '',
    }).error).toContain('代理对')
    expect(validateRewriteSelection(content, {
      baseRevision,
      startUTF16: 1,
      endUTF16: 3,
      selectedText: '🙂',
      mode: 'polish',
      instruction: '',
    }).error).toBeUndefined()
    expect(validateRewriteSelection(content, {
      baseRevision,
      startUTF16: 1,
      endUTF16: 3,
      selectedText: '错误',
      mode: 'polish',
      instruction: '',
    }).error).toContain('不一致')
  })

  it('enforces mode, custom instruction, and scalar limits', () => {
    const content = '正文选段'
    const baseRevision = rewriteContentRevision(content)
    const common = { baseRevision, startUTF16: 0, endUTF16: content.length, selectedText: content }
    expect(validateRewriteSelection(content, { ...common, mode: 'custom', instruction: '' }).error).toContain('custom')
    expect(validateRewriteSelection(content, { ...common, mode: 'unknown' as never, instruction: '' }).error).toContain('mode')
    expect(validateRewriteSelection(content, { ...common, mode: 'polish', instruction: '🙂'.repeat(2001) }).error).toContain('Unicode 标量')
  })

  it('parses a frozen task and suggestion without trusting mutable request fields', () => {
    const content = '原始选段。'
    const params = buildRewriteTaskParams('draft-2', content, {
      baseRevision: rewriteContentRevision(content),
      startUTF16: 0,
      endUTF16: content.length,
      selectedText: content,
      mode: 'expand',
      instruction: '',
    })
    const parsed = parseRewriteTaskParams({ ...params, contextBefore: '冻结前文', contextAfter: '冻结后文' })
    expect(parsed?.contextBefore).toBe('冻结前文')
    expect(parsed?.contextAfter).toBe('冻结后文')
    expect(parseRewriteSuggestion(JSON.stringify({ version: 1, suggestion: '扩写后的选段。' }), parsed!)).toMatchObject({
      draftId: 'draft-2',
      baseRevision: params.baseRevision,
      suggestion: '扩写后的选段。',
    })
    expect(parseRewriteSuggestion('{bad json', params)).toBeUndefined()
  })

  // 回归：模型顺着「选段后文」续写而没只改写选段。
  // 真实故障是 70 字选段换回 2069 字建议，应用后正文 2555 → 4554 字且剧情重复；
  // 结果非空、格式合法、字数上限（12000）也拦不住，故需要独立的续写检测。
  it('detects a suggestion that keeps writing past the selection', () => {
    // 两段上下文都要超过 40 字探测阈值，否则走不到对应分支
    const after = '雪原的夜风从帐帘缝隙里钻进来，卷走那点余温。陆芊芊仰头看着他，眸子里映着帐外一点雪光。'
    const before = '她从他臂弯里退开半步的动作很轻，却让林栩言胸口一空。帐帘掀开的一角漏进风来，两个人谁都没有先开口。'
    expect(after.length).toBeGreaterThanOrEqual(40)
    expect(before.length).toBeGreaterThanOrEqual(40)
    const params = { contextBefore: before, contextAfter: after, selectedText: '待改写的选段。' }

    // 正常改写：只输出选段的改写版
    expect(detectRewriteContinuation('她从他臂弯里退开半步，动作很轻，林栩言胸口却空了一块。', params)).toBeUndefined()
    // 扩写：变长但没逐字复现上下文，属正常
    expect(detectRewriteContinuation('她从他臂弯里退开半步，动作轻得像怕惊动什么。林栩言胸口蓦地一空，像是被谁抽走了什么。', params)).toBeUndefined()
    // 续写：把「选段后文」原样写了进来
    expect(detectRewriteContinuation(`改写后的选段。${after}`, params)).toBe('after')
    // 前置复现：把「选段前文」也写了进来
    expect(detectRewriteContinuation(`${before}改写后的选段。`, params)).toBe('before')

    // 上下文过短时不判定，避免把正常相似表达误判为续写
    expect(detectRewriteContinuation('随便什么内容', { contextBefore: '短', contextAfter: '也短', selectedText: 'x' })).toBeUndefined()
  })
})
