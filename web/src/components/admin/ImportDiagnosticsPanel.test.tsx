import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ lines: vi.fn(), previewBoundaries: vi.fn() }))
vi.mock('@/lib/api', () => ({ bookImportApi: api }))
beforeEach(() => {
  vi.clearAllMocks()
})
import type { BookImportDiagnostics } from '@shared/types'
import ImportDiagnosticsPanel from './ImportDiagnosticsPanel'

function diagnostics(overrides: Partial<BookImportDiagnostics> = {}): BookImportDiagnostics {
  return {
    stats: {
      parser: 'text',
      totalLines: 400,
      headingLines: 45,
      volumeHeadingLines: 2,
      mergedHeadingLines: 3,
      frontMatterLines: 6,
      droppedEmptyChapters: 0,
      chapterCount: 45,
      chapterChars: { min: 120, median: 2400, max: 9000 },
      frontMatterChars: 300,
      numbering: { detected: 45, min: 1, max: 90, missing: 0, duplicated: 0 },
    },
    uncertain: [
      { line: 12, raw: '   117骗了她！', verdict: 'prose', rule: 'prose', confidence: 'low', rejectedBy: 'leading-indent' },
      { line: 47, raw: '0083和哥哥同居啦！', verdict: 'heading', rule: 'bare-number-tight', confidence: 'low' },
    ],
    uncertainTotal: 2,
    anomalies: [{ code: 'chapters-missing', severity: 'warning', message: '识别到的最大章节编号为 90，但只切出 45 章，疑似有章节未识别' }],
    heuristicVersion: 2,
    ...overrides,
  }
}

const noop = () => {}

it('摘要行展示切分统计与异常计数，明细默认收起', () => {
  render(<ImportDiagnosticsPanel diagnostics={diagnostics()} aiReview={null} onReview={noop} onApply={noop} busy={false} />)

  expect(screen.getByText(/400 行中识别到 45 个章节标题/)).toBeTruthy()
  expect(screen.getByText('1 项异常')).toBeTruthy()
  expect(screen.getByText('2 行待复核')).toBeTruthy()
  // 明细收起时证据行不渲染，避免预览页被噪声塞满。
  expect(screen.queryByText('117骗了她！')).toBeNull()
})

it('展开后列出异常、统计与证据行，并说清风险方向', () => {
  render(<ImportDiagnosticsPanel diagnostics={diagnostics()} aiReview={null} onReview={noop} onApply={noop} busy={false} />)
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))

  expect(screen.getByText(/疑似有章节未识别/)).toBeTruthy()
  expect(screen.getByText('117骗了她！')).toBeTruthy()
  // 被判为正文的行要提示「若实为标题会丢失章节边界」——漏判比误判更该被看到。
  expect(screen.getByText(/若实为标题会丢失章节边界/)).toBeTruthy()
  expect(screen.getByText(/若实为正文会切出多余章节/)).toBeTruthy()
  expect(screen.getByText('编号缺号')).toBeTruthy()
})

it('运行 AI 复核触发回调，无建议时不提供采纳入口', () => {
  const onReview = vi.fn()
  const onApply = vi.fn()
  const { rerender } = render(<ImportDiagnosticsPanel diagnostics={diagnostics()} aiReview={null} onReview={onReview} onApply={onApply} busy={false} />)
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))
  fireEvent.click(screen.getByRole('button', { name: /运行 AI 复核/ }))
  expect(onReview).toHaveBeenCalledTimes(1)

  // 复核完成但没有改判：只报告，不给采纳按钮（采纳必然 409）。
  // 展开状态在重渲染后保留，无需再次点击。
  rerender(
    <ImportDiagnosticsPanel
      diagnostics={diagnostics()}
      aiReview={{
        reviewedAt: 1,
        model: 'm',
        heuristicVersion: 2,
        candidateCount: 2,
        suggestions: [],
        projectedChapterCount: 45,
        usage: { promptTokens: 1, completionTokens: 1, costMillicents: 0 },
      }}
      onReview={onReview}
      onApply={onApply}
      busy={false}
    />,
  )
  expect(screen.getByText(/未发现需要调整的章节划分/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /按建议重新识别章节/ })).toBeNull()
})

it('有改判建议时展示预计章节数并允许采纳', () => {
  const onApply = vi.fn()
  render(
    <ImportDiagnosticsPanel
      diagnostics={diagnostics()}
      aiReview={{
        reviewedAt: 1,
        model: 'm',
        heuristicVersion: 2,
        candidateCount: 2,
        suggestions: [{ line: 12, raw: '   117骗了她！', heuristic: 'prose', verdict: 'heading', confidence: 'low', reason: '启发式否决：leading-indent' }],
        projectedChapterCount: 46,
        usage: { promptTokens: 1, completionTokens: 1, costMillicents: 0 },
      }}
      onReview={noop}
      onApply={onApply}
      busy={false}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))

  expect(screen.getByText(/有 1 行建议调整/)).toBeTruthy()
  expect(screen.getByText(/采纳后预计识别为 46 章（当前 45 章）/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /按建议重新识别章节/ }))
  expect(onApply).toHaveBeenCalledTimes(1)
})

it('没有证据不足的行时直接给出可用结论', () => {
  render(
    <ImportDiagnosticsPanel
      diagnostics={diagnostics({ uncertain: [], uncertainTotal: 0, anomalies: [] })}
      aiReview={null}
      onReview={noop}
      onApply={noop}
      busy={false}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))

  expect(screen.getByText(/没有证据不足的行/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /运行 AI 复核/ })).toBeNull()
})

it('复核进行中时按钮禁用，避免重复触发', () => {
  render(<ImportDiagnosticsPanel diagnostics={diagnostics()} aiReview={null} onReview={noop} onApply={noop} busy />)
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))

  expect(screen.getByRole('button', { name: /运行 AI 复核/ })).toHaveProperty('disabled', true)
})

it('取消单条建议后只采纳所选行', () => {
  const apply = vi.fn()
  render(
    <ImportDiagnosticsPanel
      diagnostics={diagnostics()}
      busy={false}
      onReview={noop}
      onApply={apply}
      aiReview={{
        reviewedAt: 1,
        model: 'm',
        heuristicVersion: 2,
        candidateCount: 2,
        projectedChapterCount: 46,
        usage: { promptTokens: 0, completionTokens: 0, costMillicents: 0 },
        suggestions: [12, 47].map((line) => ({ line, raw: `原文 ${line}`, heuristic: 'prose', verdict: 'heading', confidence: 'low', reason: '待复核' })),
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: '采纳第 47 行建议' }))
  fireEvent.click(screen.getByRole('button', { name: /按建议重新识别章节/ }))
  expect(apply).toHaveBeenCalledWith([12])
})

it('作者说明归入正文的建议说明清楚，查看效果不采纳也不导入', async () => {
  const apply = vi.fn()
  api.previewBoundaries.mockResolvedValue({ chapterCount: 99, impacts: [{ line: 1297, raw: '100珠的加更送上啦', before: { title: '第21章', chars: 1738, excerpt: '章节开头节选' }, after: { title: '第21章', chars: 1759, excerpt: '章节末尾与作者说明' }, change: { beforeRole: 'heading', afterRole: 'prose', addedText: '100珠的加更送上啦，感谢投珠支持的宝贝们', removedText: '', addedChars: 21, removedChars: 0 }, context: [{ line: 1297, raw: '100珠的加更送上啦，感谢投珠支持的宝贝们' }] }] })
  render(<ImportDiagnosticsPanel diagnostics={diagnostics()} busy={false} onReview={noop} onApply={apply} runId="run" revision={4} aiReview={{ reviewedAt: 1, model: 'm', heuristicVersion: 2, candidateCount: 1, projectedChapterCount: 99, usage: { promptTokens: 0, completionTokens: 0, costMillicents: 0 }, suggestions: [{ line: 1297, raw: '100珠的加更送上啦', heuristic: 'heading', verdict: 'prose', confidence: 'high', reason: '作者说明' }] }} />)
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))
  expect(screen.getByText('建议：将第 1297 行作为正文，不在此处新建章节')).toBeInTheDocument()
  expect(screen.getByText(/点击「确认导入」才会写入书库/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看调整效果' }))
  await screen.findByText('整份文件按所选建议调整后，预计识别为 99 章；最终仅导入你选中的章节。')
  expect(screen.getByText('这一行不再作为章节标题，改为「第21章」的正文。')).toBeInTheDocument()
  expect(screen.getByText(/1738 → 1759 字（增加 21 字）/)).toBeInTheDocument()
  expect(screen.getByText('新增到正文的文字 · 21 字')).toBeInTheDocument()
  expect(screen.getByText('100珠的加更送上啦，感谢投珠支持的宝贝们', { selector: 'mark' })).toBeInTheDocument()
  expect(screen.queryByText('章节开头节选')).not.toBeInTheDocument()
  expect(screen.queryByText('章节末尾与作者说明')).not.toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
  expect(api.previewBoundaries).toHaveBeenCalledWith('run', 4, [expect.objectContaining({ line: 1297, verdict: 'prose' })])
  fireEvent.click(screen.getByRole('button', { name: '按建议重新识别章节 · 1 处' }))
  expect(apply).toHaveBeenCalledWith([1297])
})

it('人工修正先查看原文和切分影响，再应用指定行', async () => {
  const edit = vi.fn()
  api.lines.mockResolvedValue({ revision: 4, lines: [{ line: 12, raw: '序章' }] })
  api.previewBoundaries.mockResolvedValue({
    revision: 4,
    chapterCount: 46,
    impacts: [
      { line: 12, raw: '序章', before: { title: '前置信息', chars: 100, excerpt: '旧段落' }, after: { title: '序章', chars: 80, excerpt: '序章正文' } },
    ],
  })
  render(
    <ImportDiagnosticsPanel diagnostics={diagnostics()} busy={false} onReview={noop} onApply={noop} aiReview={null} runId="run" revision={4} onEdit={edit} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))
  fireEvent.click(screen.getByText('人工修正边界'))
  expect(screen.getByRole('button', { name: '应用人工修正' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('原文行号'), { target: { value: '12' } })
  fireEvent.click(screen.getByRole('button', { name: '查看附近原文' }))
  await screen.findByText('序章')
  expect(api.lines).toHaveBeenCalledWith('run', 12)
  fireEvent.click(screen.getByRole('button', { name: '预览修正影响' }))
  await screen.findByText('整份文件调整后，预计识别为 46 章；最终仅导入你选中的章节。')
  expect(screen.getByText('前置信息 · 正文共 100 字')).toBeInTheDocument()
  expect(screen.getByText('序章 · 正文共 80 字')).toBeInTheDocument()
  expect(screen.getByText(/此预览未包含具体边界变化/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '应用人工修正' }))
  expect(edit).toHaveBeenCalledWith([{ line: 12, verdict: 'heading' }])
  fireEvent.change(screen.getByLabelText('原文行号'), { target: { value: '47' } })
  expect(screen.getByRole('button', { name: '应用人工修正' })).toBeDisabled()
})

it('已复核进度、候选截断和撤销入口可见，原文过期后禁用操作', () => {
  const undo = vi.fn()
  const reset = vi.fn()
  render(
    <ImportDiagnosticsPanel
      diagnostics={diagnostics({ pendingCount: 350, truncatedCount: 50 })}
      aiReview={null}
      onReview={noop}
      onApply={noop}
      busy={false}
      reviewedLines={[1, 3]}
      canResplit={false}
      overrides={[{ line: 1, verdict: 'heading', source: 'manual', updatedAt: 1 }]}
      onUndo={undo}
      onReset={reset}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /展开明细/ }))
  expect(screen.getByText(/已复核 2 行 · 尚未复核 350 行/)).toBeTruthy()
  expect(screen.getByText(/另有 50 行将在后续批次处理/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '继续复核下一批' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '撤销第 1 行修正' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '恢复原始解析' })).toBeDisabled()
})
