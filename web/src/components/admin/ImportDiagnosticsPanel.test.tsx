import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
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
  expect(screen.getByText(/未发现需要改判的边界/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /采纳建议并重新切分/ })).toBeNull()
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

  expect(screen.getByText(/建议改判 1 行/)).toBeTruthy()
  expect(screen.getByText(/采纳后为 46 章（当前 45 章）/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /采纳建议并重新切分/ }))
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
