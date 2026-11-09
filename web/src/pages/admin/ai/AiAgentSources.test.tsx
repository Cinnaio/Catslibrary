import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AgentEvidence } from '@shared/ai-agent'
import AiAgentSources from './AiAgentSources'

describe('Agent evidence snapshots', () => {
  it('opens retrieved text with escaped chapter links and distinguishes archives from exact quotations', () => {
    const chapter: AgentEvidence = {
      id: 'source-1',
      kind: 'chapter',
      novelId: 'book/id',
      chapterId: 'chapter?id',
      title: '雨港',
      origin: 'published',
      revision: 'private-revision',
      offset: 0,
      endOffset: 10,
      excerpt: '<script>不应执行</script>林岚未和解。',
      truncated: true,
    }
    const archive: AgentEvidence = {
      ...chapter,
      id: 'source-2',
      kind: 'relationship',
      title: '人物关系档案',
      chapterId: undefined,
      origin: 'manual',
      throughChapter: { id: 'chapter', title: '灯塔' },
    }
    const view = render(<AiAgentSources sources={[chapter, archive]} />)
    fireEvent.click(screen.getByText('查阅依据 · 2'))
    expect(screen.getByRole('link', { name: '雨港' })).toHaveAttribute('href', '/read/book%2Fid/chapter%3Fid')
    expect(screen.getByText('人工修订档案')).toBeInTheDocument()
    expect(screen.getByText(/档案覆盖至《灯塔》/)).toHaveTextContent('并非该片段的逐句出处')
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.textContent).not.toContain('private-revision')
    expect(screen.queryByRole('link', { name: '人物关系档案' })).not.toBeInTheDocument()
  })
})
