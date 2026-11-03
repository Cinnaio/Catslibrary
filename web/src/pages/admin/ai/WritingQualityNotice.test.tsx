import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { assessWritingQuality } from '@shared/ai-writing-quality'
import WritingQualityNotice from './WritingQualityNotice'

it('explains original generation warnings after an edit without presenting a publication gate', () => {
  render(
    <WritingQualityNotice
      quality={assessWritingQuality({ text: '补全正文。'.repeat(400), targetWords: 2000, finishReason: 'length', editedSinceGeneration: true })}
    />,
  )
  expect(screen.getByLabelText('生成质量提示')).toHaveTextContent('原始生成达到上游输出上限')
  expect(screen.getByLabelText('生成质量提示')).toHaveTextContent('正文已修改')
  expect(screen.queryByText(/不足目标/)).not.toBeInTheDocument()
})

it('stays absent when the current draft has no warning', () => {
  render(<WritingQualityNotice quality={assessWritingQuality({ text: '正常正文。'.repeat(400), targetWords: 2000 })} />)
  expect(screen.queryByLabelText('生成质量提示')).not.toBeInTheDocument()
})
