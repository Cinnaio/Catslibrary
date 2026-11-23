import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryGraphResponse } from '@shared/story-graph'
import StoryGraphPanel from './StoryGraphPanel'

const api = vi.hoisted(() => ({ getStoryGraph: vi.fn(), generateStoryGraph: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { writing: api } }))
const evidence = [{ kind: 'relationship' as const, quote: '林舟与沈砚合作。[章节ID:c1]', chapterIds: ['c1'] }]
const fixture: StoryGraphResponse = {
  novel: { id: 'book', title: '测试作品' },
  anchor: { id: 'c1', title: '初遇', ordinal: 1 },
  status: 'ready',
  updatedAt: 1000,
  chapters: [{ id: 'c1', title: '初遇', ordinal: 1 }],
  archives: [{ kind: 'relationship', content: evidence[0]!.quote, eligibility: 'usable', origin: 'manual', chaptersThrough: 1 }],
  graph: {
    version: 1,
    people: [
      { id: 'p1', name: '林舟', aliases: ['阿舟'], summary: '正在查案', evidence },
      { id: 'p2', name: '沈砚', aliases: [], summary: '隐藏秘密', evidence },
    ],
    relationships: [{ id: 'r1', from: 'p1', to: 'p2', label: '合作', summary: '保留秘密的合作关系', directed: true, certainty: 'inference', evidence }],
    threads: [{ id: 't1', title: '遗失的信件', kind: 'clue', certainty: 'clue', summary: '尚未找到', people: ['p1'], evidence }],
  },
}
beforeEach(() => {
  api.getStoryGraph.mockReset().mockResolvedValue(fixture)
  api.generateStoryGraph.mockReset()
})
function mount() {
  return render(
    <MemoryRouter>
      <StoryGraphPanel novelId="book" afterChapterId="c1" />
    </MemoryRouter>,
  )
}

describe('story graph workflow', () => {
  it('links alias search to the canvas and restores all people after an empty search', async () => {
    api.getStoryGraph.mockResolvedValue({
      ...fixture,
      graph: { ...fixture.graph!, people: [...fixture.graph!.people, { id: 'p3', name: '许川', aliases: [], summary: '独自远行', evidence: [] }] },
    })
    mount()
    await screen.findByText('测试作品')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索人物或别名' }), { target: { value: '阿舟' } })
    expect(screen.getByRole('button', { name: '人物：林舟' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '人物：沈砚' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '人物：许川' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索人物或别名' }), { target: { value: '不存在的人' } })
    expect(screen.getByText('星图里还没有这个名字')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '人物：林舟' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除人物搜索' }))
    expect(screen.getByRole('button', { name: '人物：许川' })).toBeInTheDocument()
    expect(api.generateStoryGraph).not.toHaveBeenCalled()
  })
  it('follows a person into a thread and restores the full map with an explicit overview action', async () => {
    mount()
    await screen.findByText('测试作品')
    fireEvent.click(within(screen.getByRole('generic', { name: '人物列表' })).getByRole('button', { name: '林舟' }))
    expect(screen.getByRole('checkbox', { name: '只看相关人物' })).toBeChecked()
    expect(within(screen.getByRole('complementary')).getByRole('heading', { name: '林舟' })).toHaveFocus()
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /遗失的信件/ }))
    expect(screen.getByRole('checkbox', { name: '显示相关情节' })).toBeChecked()
    expect(screen.getByRole('button', { name: '情节：遗失的信件' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '人物：沈砚' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回到全景' }))
    expect(screen.getByRole('button', { name: '人物：沈砚' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '人物索引' })).toHaveAttribute('aria-selected', 'true')
  })
  it('preserves the current map on a refresh failure and leaves generation manual', async () => {
    mount()
    await screen.findByText('测试作品')
    api.getStoryGraph.mockRejectedValueOnce(new Error('暂时无法读取'))
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取')
    expect(screen.getByRole('button', { name: '人物：林舟' })).toBeInTheDocument()
    expect(api.generateStoryGraph).not.toHaveBeenCalled()
  })
  it('clears the previous scope immediately and ignores its late generation result', async () => {
    api.getStoryGraph.mockResolvedValueOnce({ ...fixture, status: 'missing', graph: null })
    let completeGeneration!: (value: StoryGraphResponse) => void
    let completeNext!: (value: StoryGraphResponse) => void
    api.generateStoryGraph.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeGeneration = resolve
        }),
    )
    const view = mount()
    await screen.findByText('测试作品')
    fireEvent.click(screen.getByRole('button', { name: '生成故事图谱' }))
    api.getStoryGraph.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeNext = resolve
        }),
    )
    view.rerender(
      <MemoryRouter>
        <StoryGraphPanel novelId="next" afterChapterId="next-chapter" />
      </MemoryRouter>,
    )
    expect(screen.queryByText('测试作品')).not.toBeInTheDocument()
    await act(async () => {
      completeGeneration(fixture)
    })
    expect(screen.queryByRole('button', { name: '人物：林舟' })).not.toBeInTheDocument()
    await act(async () => {
      completeNext({ ...fixture, novel: { id: 'next', title: '另一部作品' }, graph: { version: 1, people: [], relationships: [], threads: [] } })
    })
    expect(screen.getByText('另一部作品')).toBeInTheDocument()
    expect(screen.queryByText('测试作品')).not.toBeInTheDocument()
  })
  it('keeps chapter links and report provenance available in the report tab', async () => {
    mount()
    await screen.findByText('测试作品')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '文字报告' }), { button: 0, ctrlKey: false })
    const detail = screen.getByRole('complementary')
    expect(within(detail).getByText(evidence[0]!.quote)).toBeInTheDocument()
    expect(within(detail).getByText('截至 1 章 · 人工校正')).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: '更新或人工校正' })).toHaveAttribute('href', '/admin/ai?sub=writing&novel=book&afterChapterId=c1')
  })

  it('explains an opaque gateway failure and does not automatically regenerate', async () => {
    api.getStoryGraph.mockResolvedValue({ ...fixture, status: 'missing', graph: null })
    api.generateStoryGraph.mockRejectedValue(new Error('HTTP 502'))
    mount()
    await screen.findByText('把人物与故事连起来')
    fireEvent.click(screen.getByRole('button', { name: '生成故事图谱' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('未收到具体错误原因')
    expect(screen.getByRole('alert')).toHaveTextContent('请先刷新状态确认结果')
    expect(api.generateStoryGraph).toHaveBeenCalledTimes(1)
  })
  it('reads without generating and opens directional relations with archive evidence', async () => {
    mount()
    await screen.findByText('测试作品')
    expect(api.getStoryGraph).toHaveBeenCalledWith('book', 'c1')
    expect(api.generateStoryGraph).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('button', { name: '林舟到沈砚：合作' }), { key: 'Enter' })
    const detail = screen.getByRole('complementary', { name: '图谱详情' })
    expect(within(detail).getByText('分析推断')).toBeInTheDocument()
    expect(within(detail).getByText('林舟 → 沈砚')).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: '初遇' })).toHaveAttribute('href', '/read/book/c1')
  })
  it('searches aliases and keeps related unresolved threads accessible without cluttering the canvas', async () => {
    mount()
    await screen.findByText('测试作品')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索人物或别名' }), { target: { value: '阿舟' } })
    const list = screen.getByRole('generic', { name: '人物列表' })
    expect(within(list).queryByRole('button', { name: '沈砚' })).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: '林舟' }))
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: /遗失的信件/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '情节：遗失的信件' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '显示相关情节' }))
    expect(screen.getByRole('button', { name: '情节：遗失的信件' })).toBeInTheDocument()
  })
  it('does not expose an outdated graph and generates only after explicit action', async () => {
    api.getStoryGraph.mockResolvedValue({ ...fixture, status: 'outdated' })
    api.generateStoryGraph.mockResolvedValue(fixture)
    mount()
    await screen.findByText('分析范围或报告已变化')
    expect(screen.queryByRole('button', { name: '人物：林舟' })).not.toBeInTheDocument()
    expect(api.generateStoryGraph).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '更新图谱' }))
    await screen.findByRole('button', { name: '人物：林舟' })
    expect(api.generateStoryGraph).toHaveBeenCalledWith('book', 'c1', expect.any(Function))
  })
  it.each(['模型回复被截断', 'people[0].evidenceIds[0]：证据 ID 不属于本次有效档案，请重新生成'])(
    'shows actionable failure %s and allows retry',
    async (message) => {
      api.getStoryGraph.mockResolvedValue({ ...fixture, status: 'missing', graph: null })
      api.generateStoryGraph.mockRejectedValue(new Error(message))
      mount()
      await screen.findByText('把人物与故事连起来')
      fireEvent.click(screen.getByRole('button', { name: '生成故事图谱' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      await waitFor(() => expect(screen.getByRole('button', { name: '生成故事图谱' })).toBeEnabled())
    },
  )
})
