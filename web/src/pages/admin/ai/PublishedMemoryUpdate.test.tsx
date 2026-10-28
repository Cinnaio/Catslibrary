import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PublishedMemoryUpdate from './PublishedMemoryUpdate'

const api = vi.hoisted(() => ({ list: vi.fn(), getPlotState: vi.fn(), getRelationshipProfile: vi.fn(), startMemoryTask: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { writing: api }, chaptersApi: { list: api.list } }))
const missing = () => ({ eligibility: 'missing', isOlderThanAnchor: false, effectiveContent: '', effectiveOrigin: 'none', baseProfileRevision: '' })
const ready = () => ({ ...missing(), eligibility: 'usable', effectiveContent: '完整档案', source: { chapterId: 'new', chapterOrdinal: 2 } })
const running = () => ({
  ...missing(),
  memoryTask: { status: 'running', current: 1, total: 2, step: '分析新增章节' },
  progress: { processedChapters: 1, totalChapters: 2, targetChapterId: 'new' },
})
beforeEach(() => {
  vi.resetAllMocks()
  api.list.mockResolvedValue({
    chapters: [
      { id: 'old', title: '旧章节' },
      { id: 'new', title: '刚发布的章节' },
    ],
  })
  api.getPlotState.mockResolvedValue(missing())
  api.getRelationshipProfile.mockResolvedValue(missing())
  api.startMemoryTask.mockImplementation(async (_id, kind) => {
    ;(kind === 'plot' ? api.getPlotState : api.getRelationshipProfile).mockResolvedValue(running())
    return { task: { status: 'running' } }
  })
})
afterEach(() => vi.useRealTimers())
function open(autoStart = false) {
  return render(
    <StrictMode>
      <MemoryRouter>
        <PublishedMemoryUpdate novelId="book" novelTitle="示例小说" autoStart={autoStart} onClose={vi.fn()} />
      </MemoryRouter>
    </StrictMode>,
  )
}
it('publishing only displays the prompt; one click submits both kinds to the same latest published anchor', async () => {
  open()
  await screen.findByText('更新至第 2 章「刚发布的章节」')
  expect(api.startMemoryTask).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '一键更新情节与关系' }))
  await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledTimes(2))
  expect(api.startMemoryTask).toHaveBeenCalledWith('book', 'plot', 3, 'new')
  expect(api.startMemoryTask).toHaveBeenCalledWith('book', 'relationship', 3, 'new')
  expect(await screen.findByText('情节状态：更新中 · 已保存 1 / 2 章')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '一键更新情节与关系' })).toBeDisabled()
})

it('does not treat an up-to-date legacy archive as an initialized incremental ledger', async () => {
  api.getPlotState.mockResolvedValue({ ...ready(), memoryNeedsInitialization: true })
  api.getRelationshipProfile.mockResolvedValue({ ...ready(), memoryNeedsInitialization: true })
  open()
  await screen.findByText('更新至第 2 章「刚发布的章节」')
  fireEvent.click(screen.getByRole('button', { name: '一键更新情节与关系' }))
  await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledTimes(2))
})
it('row action submits once in StrictMode and skips already valid profiles', async () => {
  api.getPlotState.mockResolvedValue(ready())
  open(true)
  await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledTimes(1))
  expect(api.startMemoryTask).toHaveBeenCalledWith('book', 'relationship', 3, 'new')
  expect(screen.getByText('情节状态：已更新至第 2 章，可用于续写')).toBeInTheDocument()
})
it('keeps successful work and retries only a failed job', async () => {
  api.startMemoryTask.mockImplementation(async (_id, kind) => {
    if (kind === 'plot') api.getPlotState.mockResolvedValue(ready())
    else api.getRelationshipProfile.mockResolvedValue({ ...missing(), memoryTask: { status: 'failed', error: '上游超时' } })
    return { task: { status: 'completed' } }
  })
  open(true)
  expect(await screen.findByText('上游超时')).toBeInTheDocument()
  expect(screen.getByText('情节状态：已更新至第 2 章，可用于续写')).toBeInTheDocument()
  api.startMemoryTask.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '重试关系画像' }))
  await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledTimes(1))
  expect(api.startMemoryTask).toHaveBeenCalledWith('book', 'relationship', 3, 'new')
})
it('does not spend model calls when initial progress cannot be read', async () => {
  api.getRelationshipProfile.mockRejectedValue(new Error('网络故障'))
  open(true)
  expect(await screen.findByText('网络故障')).toBeInTheDocument()
  expect(api.startMemoryTask).not.toHaveBeenCalled()
})
it('refresh preserves the fixed anchor even if more chapters arrive', async () => {
  open()
  await screen.findByText('更新至第 2 章「刚发布的章节」')
  api.list.mockResolvedValue({ chapters: [{ id: 'later', title: '稍后发布' }] })
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '一键更新情节与关系' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '一键更新情节与关系' }))
  await waitFor(() => expect(api.startMemoryTask).toHaveBeenCalledWith('book', 'plot', 3, 'new'))
})
it('polls jobs started after the initial read and displays completion', async () => {
  open()
  await screen.findByText('更新至第 2 章「刚发布的章节」')
  fireEvent.click(screen.getByRole('button', { name: '一键更新情节与关系' }))
  await screen.findByText('情节状态：更新中 · 已保存 1 / 2 章')
  api.getPlotState.mockResolvedValue(ready())
  api.getRelationshipProfile.mockResolvedValue(ready())
  await waitFor(() => expect(screen.getByRole('button', { name: '两项档案均已更新' })).toBeDisabled(), { timeout: 6000 })
})
it('existing older jobs remain visible and require an explicit continuation after they finish', async () => {
  api.getPlotState.mockResolvedValue({ ...running(), progress: { processedChapters: 0, totalChapters: 1, targetChapterId: 'old' } })
  api.getRelationshipProfile.mockResolvedValue(ready())
  open(true)
  expect(await screen.findByText('已有任务正在处理较早章节，完成后请继续更新至本次目标。')).toBeInTheDocument()
  expect(api.startMemoryTask).not.toHaveBeenCalled()
})
it('empty published library never submits a model request', async () => {
  api.list.mockResolvedValue({ chapters: [] })
  open(true)
  expect(await screen.findByText('暂无已发布章节，发布后可更新档案。')).toBeInTheDocument()
  expect(api.startMemoryTask).not.toHaveBeenCalled()
})
it('ignores a late response after the selected novel is replaced', async () => {
  let resolve!: (value: ReturnType<typeof ready>) => void
  api.getPlotState.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const view = open()
  await waitFor(() => expect(api.getPlotState).toHaveBeenCalled())
  view.unmount()
  await act(async () => resolve(ready()))
  expect(api.startMemoryTask).not.toHaveBeenCalled()
})
