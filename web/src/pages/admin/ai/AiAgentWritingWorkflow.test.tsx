import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import type { AgentChapterPlan, AgentStoryThreadState } from '@shared/ai-agent'
import AiAgentStoryThreads from './AiAgentStoryThreads'
import AiAgentOutline from './AiAgentOutline'

const api = vi.hoisted(() => ({ storyThreads: vi.fn(), saveStoryThread: vi.fn(), removeStoryThread: vi.fn(), applyStoryThreads: vi.fn(), outline: vi.fn(), applyOutlineChapter: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: api }))
const plan: AgentChapterPlan = { version: 1, revision: 4, updatedAt: 1, title: '门后', goal: '检查钥匙', beats: '走近大门', characters: '', constraints: '', ending: '', targetWords: 2000 }
const state: AgentStoryThreadState = { sourceRevision: 'source', graphStatus: 'ready', candidates: [], plans: [{ id: 'thread-plan', thread: { id: 'clue', title: '铜钥匙', summary: '钥匙仍在主角手中', kind: 'clue', certainty: 'clue', people: [], evidence: [{ kind: 'plot', quote: '她收起钥匙。', chapterIds: ['chapter'] }] }, disposition: 'advance', note: '', revision: 2, sourceRevision: 'source', sourceAnchorId: 'chapter', stale: false }] }
const props = () => ({ sessionId: 'session', novelId: 'book', plan, disabled: false, onBack: vi.fn(), onBusyChange: vi.fn(), onApplied: vi.fn(), onDiscuss: vi.fn().mockResolvedValue(undefined) })
beforeEach(() => { vi.resetAllMocks(); api.storyThreads.mockResolvedValue(structuredClone(state)) })
function show(p = props()) {
  render(<MemoryRouter><Dialog open><AiAgentStoryThreads {...p} /></Dialog></MemoryRouter>)
  return { p, user: userEvent.setup() }
}
it('applies only the chosen source and version after an explicit author action', async () => {
  const { p, user } = show()
  api.applyStoryThreads.mockResolvedValue({ plan: { ...plan, revision: 5 } })
  await user.click(await screen.findByRole('checkbox', { name: /铜钥匙/ }))
  expect(api.applyStoryThreads).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '保存本章线索选择（1/6）' }))
  expect(api.applyStoryThreads).toHaveBeenCalledExactlyOnceWith('session', ['thread-plan'], [2], 4)
  await waitFor(() => expect(p.onApplied).toHaveBeenCalled())
})
it('allows removing a stale selection while preventing its reattachment', async () => {
  api.storyThreads.mockResolvedValue({ ...state, plans: [{ ...state.plans[0], stale: true }] })
  const { user } = show({ ...props(), plan: { ...plan, storyThreads: state.plans } })
  const checkbox = await screen.findByRole('checkbox', { name: /铜钥匙/ })
  expect(screen.getByRole('button', { name: '保存本章线索选择（1/6）' })).toBeDisabled()
  await user.click(checkbox)
  expect(checkbox).toBeDisabled()
  expect(screen.getByRole('button', { name: '保存本章线索选择（0/6）' })).toBeEnabled()
})
it('keeps author notes when a stale-version save fails and does not mark a clue resolved implicitly', async () => {
  const { user } = show()
  await user.click(await screen.findByRole('button', { name: '调整安排' }))
  await user.type(screen.getByLabelText('安排说明'), '已在第三章开门，先核对原文')
  await user.click(screen.getByRole('button', { name: '已回收' }))
  expect(api.saveStoryThread).not.toHaveBeenCalled()
  api.saveStoryThread.mockRejectedValue(new Error('线索安排已变化，请刷新核对'))
  await user.click(screen.getByRole('button', { name: '确认已回收' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('已变化')
  expect(screen.getByLabelText('安排说明')).toHaveValue('已在第三章开门，先核对原文')
  expect(api.saveStoryThread).toHaveBeenCalledWith('session', expect.objectContaining({ id: 'thread-plan', expectedRevision: 2, disposition: 'resolved' }))
})
it('hands a progress question to the conversation without changing any arrangement', async () => {
  const { p, user } = show()
  await user.click(await screen.findByRole('button', { name: '请助手核对进展' }))
  expect(p.onDiscuss).toHaveBeenCalledWith(expect.stringContaining('是否回收由我决定'))
  expect(api.saveStoryThread).not.toHaveBeenCalled()
  expect(api.applyStoryThreads).not.toHaveBeenCalled()
})
it('shows actual outline progress and opens the correct book conversation without writing prose', async () => {
  const p = { sessionId: 'session', novelId: 'book', currentPlan: plan, disabled: false, workflowAvailable: true, onBack: vi.fn(), onBusyChange: vi.fn(), onApplied: vi.fn(), onDiscuss: vi.fn().mockResolvedValue(undefined) }
  api.outline.mockResolvedValue({ outline: { revision: 2, chapters: [{ id: 'one', title: '雨夜', goal: '寻找钥匙', beats: '走进院子', progress: { status: 'published', changedSinceWriting: true, drafts: [{ id: 'draft', title: '实际章节', sessionId: 'source-session', status: 'published', chapterId: 'published' }] } }, { id: 'two', title: '门后', goal: '开门', beats: '检查钥匙', progress: { status: 'planned', changedSinceWriting: false, drafts: [] } }] } })
  render(<MemoryRouter><Dialog open><AiAgentOutline {...p} /></Dialog></MemoryRouter>)
  expect(await screen.findByText('待写 · 下一项')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '打开创作对话' })).toHaveAttribute('href', '/admin/ai?sub=agent&novel=book&session=source-session')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '请助手核对进度并完善大纲' }))
  expect(p.onDiscuss).toHaveBeenCalledWith(expect.stringContaining('暂不生成正文'))
  expect(api.applyOutlineChapter).not.toHaveBeenCalled()
})

it('clears a selection deleted on another device and retains the exact graph reading scope', async () => {
  api.storyThreads.mockResolvedValue({ ...state, plans: [] })
  const p = { ...props(), plan: { ...plan, storyThreads: state.plans }, afterChapterId: 'anchor' }
  render(<MemoryRouter><Dialog open><AiAgentStoryThreads {...p} /></Dialog></MemoryRouter>)
  await screen.findByText('没有尚未加入的匹配线索。')
  expect(screen.getByRole('link', { name: '打开故事星图' })).toHaveAttribute('href', '/admin/ai?sub=graph&novel=book&afterChapterId=anchor')
  expect(screen.getByRole('button', { name: '保存本章线索选择（1/6）' })).toBeDisabled()
  await userEvent.setup().click(screen.getByRole('button', { name: '清空本章选择' }))
  expect(screen.getByRole('button', { name: '保存本章线索选择（0/6）' })).toBeEnabled()
})


it('saves planned recovery and a partial progress record while retaining inputs after a quote conflict', async () => {
  api.storyThreads.mockResolvedValue({ ...state, trackingAvailable: true, currentChapterNumber: 2 })
  const { user } = show()
  await user.click(await screen.findByRole('button', { name: '调整安排' }))
  await user.click(screen.getByRole('button', { name: '部分回收' }))
  await user.type(screen.getByLabelText('计划目录位置'), '10')
  await user.type(screen.getByLabelText('计划剧情阶段'), '揭晓门派')
  await user.click(screen.getByText('记录一次实际推进'))
  await user.type(screen.getByLabelText('推进发生的目录位置'), '1')
  await user.type(screen.getByLabelText('原文摘录'), '她收起钥匙。')
  await user.type(screen.getByLabelText('这次推进了什么'), '主人仍然未知')
  api.saveStoryThread.mockRejectedValue(new Error('摘录与当前正文不匹配'))
  await user.click(screen.getByRole('button', { name: '保存安排' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('不匹配')
  expect(screen.getByLabelText('计划目录位置')).toHaveValue('10')
  expect(screen.getByLabelText('原文摘录')).toHaveValue('她收起钥匙。')
  expect(api.saveStoryThread).toHaveBeenCalledWith('session', expect.objectContaining({ disposition: 'partial', targetChapterNumber: 10,
    targetStage: '揭晓门派', progressRecord: { chapterNumber: 1, quote: '她收起钥匙。', note: '主人仍然未知' } }))
})

it('shows due reminders and changed quotations with a source link without automatically resolving a thread', async () => {
  api.storyThreads.mockResolvedValue({ ...state, trackingAvailable: true, currentChapterNumber: 2, plans: [{ ...state.plans[0],
    disposition: 'partial', targetChapterNumber: 2, reminder: 'due', progress: [{ id: 'progress', chapterId: 'source', chapterTitle: '起点',
      chapterNumber: 1, chapterRevision: 'hash', quote: '她收起钥匙。', note: '持有人已知', kind: 'partial', recordedAt: 1, sourceChanged: true }] }] })
  const { user } = show()
  expect(await screen.findByText(/已到计划处理位置/)).toBeInTheDocument()
  await user.click(screen.getByText('推进记录（1）'))
  expect(screen.getByText(/来源正文或目录信息已变化/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '回读推进章节' })).toHaveAttribute('href', '/read/book/source')
  expect(api.saveStoryThread).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: /铜钥匙/ })).toBeEnabled()
})


it('refreshes a stale source only after the author selects and saves its current counterpart', async () => {
  api.storyThreads.mockResolvedValue({ ...state, trackingAvailable: true, sourceRevision: 'new-source', candidates: [state.plans[0]!.thread],
    plans: [{ ...state.plans[0], stale: true, targetChapterNumber: 10 }] })
  const { user } = show()
  await user.click(await screen.findByRole('button', { name: '调整安排' }))
  await user.click(screen.getByRole('combobox', { name: '更新线索来源' }))
  await user.click(screen.getByRole('option', { name: /铜钥匙/ }))
  expect(api.saveStoryThread).not.toHaveBeenCalled()
  api.saveStoryThread.mockResolvedValue({ ...state, trackingAvailable: true })
  await user.click(screen.getByRole('button', { name: '保存安排' }))
  await waitFor(() => expect(api.saveStoryThread).toHaveBeenCalledWith('session', expect.objectContaining({
    id: 'thread-plan', refreshSource: true, sourceRevision: 'new-source', threadId: 'clue', targetChapterNumber: 10,
  })))
})
