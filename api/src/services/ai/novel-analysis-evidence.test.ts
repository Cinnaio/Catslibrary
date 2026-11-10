import { expect, it } from 'vitest'
import type { AnalysisSource } from '@shared/novel-analysis'
import { checkAnalysisEvidence, findAnalysisQuote } from './novel-analysis-evidence'
import { buildAnalysisReviewPacket, parseAnalysisFactResult, parseParagraphStarts } from './novel-analysis-facts'

const source = (id: string, text: string, extra: Partial<AnalysisSource> = {}): AnalysisSource => ({ id, text, chapterId: id,
  chapterTitle: id, chapterOrdinal: 1, part: 1, offset: 0, endOffset: text.length, revision: id, ...extra })
const sources = [source('S1', '青遥担心父母看到信，立刻关上抽屉。'), source('S2', '父母那时在邻镇，晚上才回来。')]

it('概括、拼接和排版变化不能标成逐字一致，概念性引号保留为待核对', () => {
  const result = checkAnalysisEvidence('原文：“青遥怕父母看见信。”[[S1]]\n原文：“青遥担心……关上抽屉。”[[S1]]\n这是“疏离”主题。\n原文：“青遥担心 父母看到信”[[S1]]', sources)
  expect(result.items.map(i => i.status)).toEqual(['not_found', 'not_found', 'uncertain', 'not_found'])
})
it('跨章问答分别定位，错源不能被同段另一处编号掩盖', () => {
  const ss = [source('S92', '她问：“明天你会来吗？”'), source('S93', '他答：“我明天一定会来。”')]
  const result = checkAnalysisEvidence('她问：“明天你会来吗？”[[S93]]，他答：“我明天一定会来。”[[S93]]', ss)
  expect(result.items.map(i => i.status)).toEqual(['wrong_source', 'matched'])
  expect(result.items[0]?.matches[0]?.sourceIds).toEqual(['S92'])
  expect(checkAnalysisEvidence('她问：“明天你会来吗？”[[S92]]，他答：“我明天一定会来。”[[S93]]', ss).items.every(i => i.status === 'matched')).toBe(true)
})
it('旧报告整句末尾合并来源不认证逐句出处，但仍能定位概括和跨章错引', () => {
  const ss = [source('S1', '她问：“明天你会来吗？”'), source('S2', '他答：“我明天一定会来。”')]
  const report = '她问出“明天你会来吗？”，他答“我明天一定会来。”[[S2]]。又给出“明日肯定会赴约”的承诺，补了一句“我明天一定会来。”[[S2]]。'
  const items = checkAnalysisEvidence(report, ss).items
  expect(items.map(i => i.status)).toEqual(['wrong_source', 'matched', 'not_found', 'matched'])
  expect(checkAnalysisEvidence('她问出“明天你会来吗？”，随后等待回答[[S1]]。', ss).items[0]?.status).toBe('uncertain')
})
it('Markdown 引文正确分离末尾来源编号', () => {
  expect(checkAnalysisEvidence('> 青遥担心父母看到信，立刻关上抽屉。 [[S1]]', sources).items[0]?.status).toBe('matched')
})
it('优先查明示来源，不因六个全范围候选上限漏掉后章正确引句', () => {
  const ss = Array.from({ length: 9 }, (_, i) => source(`S${i + 1}`, '她独自坐在窗边。'))
  const item = checkAnalysisEvidence('原文：“她独自坐在窗边。”[[S7]]', ss).items[0]!
  expect(item.status).toBe('matched')
  expect(item.matches.map(m => m.sourceIds)).toEqual([['S7']])
})
it('长概念引号即使紧邻来源也不误判为伪引语', () => {
  expect(checkAnalysisEvidence('本章主题是“失落后的自我重建”[[S1]]', [source('S1', '她失败后重新学习。')]).items[0]?.status).toBe('uncertain')
  expect(checkAnalysisEvidence('原文：“青遥担心父母看到信”[[S1]][[S999]]', sources).items[0]?.status).toBe('wrong_source')
})
it('重复原句不擅自选出处，未标来源不认证，保留 UTF-16 对照位置', () => {
  const ss = [source('S1', '😀明天你会来吗？明天你会来吗？'), source('S2', '明天你会来吗？')]
  const report = '😀她问：“明天你会来吗？”[[S1]]\n她问：“明天你会来吗？”'
  const result = checkAnalysisEvidence(report, ss)
  expect(result.items.map(i => i.status)).toEqual(['ambiguous', 'missing_source'])
  expect(report.slice(result.items[0]!.start, result.items[0]!.end)).toBe('“明天你会来吗？”')
  for (const m of result.items[0]!.matches) expect(ss[0]!.text.slice(m.start, m.end)).toBe(m.quote)
})
it('只允许同章连续分段拼接，不连接跨章或不连续片段', () => {
  const ss = [source('S1', '青遥担心', { chapterId: 'c', revision: 'r' }), source('S2', '父母看到信。', { chapterId: 'c', revision: 'r', offset: 4, endOffset: 10, part: 2 })]
  expect(findAnalysisQuote('青遥担心父母看到信。', ss)[0]?.sourceIds).toEqual(['S1', 'S2'])
  expect(checkAnalysisEvidence('原文：“青遥担心父母看到信。”[[S1]][[S2]]', ss).items[0]?.status).toBe('matched')
  expect(findAnalysisQuote('青遥担心父母看到信。', [ss[0]!, { ...ss[1]!, chapterId: 'other' }])).toEqual([])
  expect(findAnalysisQuote('青遥担心父母看到信。', [ss[0]!, { ...ss[1]!, offset: 5 }])).toEqual([])
})
it('有界扫描明确部分覆盖；正确引句不会因句数多被抹去', () => {
  const text = Array.from({ length: 201 }, () => '原文：“青遥担心父母看到信”[[S1]]').join('\n')
  expect(checkAnalysisEvidence(text, sources)).toMatchObject({ coverage: 'partial', scannedQuotes: 200, totalQuotes: 201 })
  expect(checkAnalysisEvidence(text, sources).items.every(i => i.status === 'matched')).toBe(true)
})
it('核对只覆盖整段和实际原文，拒绝旧段落偏移，预算不足不冒充完整', () => {
  const content = Array.from({ length: 10 }, (_, i) => `结论${i}。[[S${i + 1}]]`).join('\n\n')
  const ss = Array.from({ length: 10 }, (_, i) => source(`S${i + 1}`, '字'.repeat(12000)))
  const packet = buildAnalysisReviewPacket(content, ss)
  expect(packet.coverage).toMatchObject({ skipped: 8, sourceChars: 24000 })
  expect(packet.coverage.segments).toHaveLength(2)
  expect(() => buildAnalysisReviewPacket(content, ss, [9999])).toThrow()
  expect(() => parseParagraphStarts([1, 1])).toThrow()
  expect(buildAnalysisReviewPacket('无引用的断言', ss).coverage.segments).toEqual([])
})
it('验证证据逐项容错，拒绝虚构或拼接原文，不信任模型偏移', () => {
  const original = '青遥关上抽屉时，父母正在旁边。[[S1]]'
  const packet = buildAnalysisReviewPacket(original, sources)
  const item = { segmentId: 'P0', original, kind: 'inference', explanation: '担心不等于在场', suggestion: '青遥只是担心父母看到信。[[S1]]', evidence: [{ sourceId: 'S1', quote: sources[0]!.text }] }
  const result = parseAnalysisFactResult(JSON.stringify({ checkedSegmentIds: ['P0'], findings: [item, { ...item, original: '父母正在旁边', evidence: [{ sourceId: 'S2', quote: '父母在旁边。' }] }] }), packet)
  expect(result).toMatchObject({ rejected: 1, partial: true })
  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({ start: 0, end: original.length })
  expect(() => parseAnalysisFactResult('空白', packet)).toThrow()
  expect(() => parseAnalysisFactResult('{"checkedSegmentIds":[],"findings":[]}', packet)).toThrow()
})
it('原句内部的替换不把重复来源塞进引号，也不接受新的伪引语', () => {
  const report = '原文写道：“青遥很担心信被人看到。”[[S1]]'
  const packet = buildAnalysisReviewPacket(report, sources)
  const finding = { segmentId: 'P0', original: '青遥很担心信被人看到。', kind: 'citation', explanation: '概括不等于原句', suggestion: source('S1', '').text,
    evidence: [{ sourceId: 'S1', quote: sources[0]!.text }] }
  const parse = (suggestion: string) => parseAnalysisFactResult(JSON.stringify({ checkedSegmentIds: ['P0'], findings: [{ ...finding, suggestion }] }), packet)
  const result = parse(`${sources[0]!.text}[[S1]]`)
  expect(result.items[0]?.suggestion).toBe(sources[0]!.text)
  const fixed = report.slice(0, result.items[0]!.start) + result.items[0]!.suggestion + report.slice(result.items[0]!.end)
  expect(checkAnalysisEvidence(fixed, sources).items[0]?.status).toBe('matched')
  expect(parse('另一个概括[[S2]]')).toMatchObject({ items: [], rejected: 1, partial: true })
})
it('整句修订也不能在已验证证据旁制造新的直接伪引语', () => {
  const original = '青遥很担心。[[S1]]', packet = buildAnalysisReviewPacket(original, sources)
  const output = { checkedSegmentIds: ['P0'], findings: [{ segmentId: 'P0', original, kind: 'citation', explanation: '换成原句',
    suggestion: '原文：“青遥十分担心父母发现书信。”[[S1]]', evidence: [{ sourceId: 'S1', quote: sources[0]!.text }] }] }
  expect(parseAnalysisFactResult(JSON.stringify(output), packet)).toMatchObject({ items: [], rejected: 1, partial: true })
})
it('仅替换来源编号也必须校验完整引语绑定', () => {
  const ss = [source('S1', '父亲独自留在城里。'), source('S2', '母亲后来去了邻镇。')]
  const packet = buildAnalysisReviewPacket('原文：“父亲独自留在城里。”[[S1]]', ss)
  const output = { checkedSegmentIds: ['P0'], findings: [{ segmentId: 'P0', original: '[[S1]]', kind: 'citation', explanation: '修改来源',
    suggestion: '[[S2]]', evidence: [{ sourceId: 'S2', quote: ss[1]!.text }] }] }
  expect(parseAnalysisFactResult(JSON.stringify(output), packet)).toMatchObject({ items: [], rejected: 1, partial: true })
})
