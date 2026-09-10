import { describe, expect, it } from 'vitest'
import {
  buildRewriteTaskParams,
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
})
