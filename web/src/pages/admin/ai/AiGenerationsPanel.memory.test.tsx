import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import AiGenerationsPanel from './AiGenerationsPanel'
import { assessWritingQuality, type WritingQualityReport } from '@shared/ai-writing-quality'
const mocks = vi.hoisted(() => ({ generations: vi.fn(), publishBatch: vi.fn(), publishDraft: vi.fn(), confirm: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({
  aiApi: {
    generations: mocks.generations,
    status: async () => ({ configured: true }),
    writing: { publishBatch: mocks.publishBatch, publishDraft: mocks.publishDraft },
  },
  newOperationId: () => 'operation',
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: mocks.confirm }) }))
vi.mock('./PublishedMemoryUpdate', () => ({
  default: ({ novelId, autoStart }: { novelId: string; autoStart: boolean }) => (
    <div data-testid="memory-update">
      {novelId}:{autoStart ? 'start' : 'prompt'}
    </div>
  ),
}))
vi.mock('./DraftReview', () => ({ default: () => null }))
vi.mock('./DraftRewrite', () => ({ default: () => null }))
const chapter = (id: string, status = 'draft') => ({
  id,
  kind: 'continue',
  model: 'model',
  novelId: 'book',
  novelTitle: '示例小说',
  status,
  result: '正文',
  batchId: 'batch',
  batchIndex: id === 'first' ? 1 : 2,
  batchCount: 2,
  chapterTitle: '',
  draftTitle: '新章节',
  contentRevision: 'r1',
  createdAt: 1,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.publishBatch.mockResolvedValue({ published: [{ chapterId: 'c1' }, { chapterId: 'c2' }] })
  mocks.publishDraft.mockResolvedValue({ chapterId: 'c1' })
})
function open(items: Array<ReturnType<typeof chapter> & { quality?: WritingQualityReport }>) {
  mocks.generations.mockResolvedValue({ items, total: items.length > 1 ? 1 : items.length })
  render(
    <MemoryRouter>
      <AiGenerationsPanel scope="writing" status="all" />
    </MemoryRouter>,
  )
}
it('batch publish surfaces the update prompt without automatically starting paid analysis', async () => {
  open([chapter('first'), chapter('second')])
  fireEvent.click(await screen.findByRole('button', { name: '整批发布' }))
  await waitFor(() => expect(mocks.publishBatch).toHaveBeenCalledWith('batch', { novelId: 'book' }))
  expect(await screen.findByTestId('memory-update')).toHaveTextContent('book:prompt')
})
it('published batches retain the one-click action on a fresh visit', async () => {
  open([
    { ...chapter('second', 'published'), draftTitle: '第二章标题', result: '第二章的完整正文' },
    { ...chapter('first', 'published'), draftTitle: '第一章标题', result: '第一章的完整正文' },
  ])
  await userEvent.click(await screen.findByRole('button', { name: /更多操作/ }))
  const item = await screen.findByRole('menuitem', { name: /更新故事档案/ })
  await userEvent.click(item)
  expect(screen.getByTestId('memory-update')).toHaveTextContent('book:start')
  await userEvent.click(screen.getByRole('button', { name: '查看' }))
  const directory = screen.getByRole('list', { name: '续写章节目录' })
  expect(within(directory).getAllByRole('listitem').map(row => row.textContent)).toEqual([
    expect.stringContaining('第一章标题'),
    expect.stringContaining('第二章标题'),
  ])
  expect(within(screen.getByRole('dialog')).queryByText('第一章的完整正文')).not.toBeInTheDocument()
  await userEvent.click(within(directory).getByRole('button', { name: '查看第 2 章：第二章标题' }))
  expect(within(screen.getByRole('region', { name: '生成内容' })).getByText('第二章的完整正文')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '返回集合' }))
  expect(screen.getByRole('list', { name: '续写章节目录' })).toBeInTheDocument()
})
it('unpublished drafts have no formal-memory update action', async () => {
  open([chapter('first')])
  await screen.findByRole('button', { name: '审阅' })
  const more = screen.queryByRole('button', { name: /更多操作/ })
  if (more) {
    await userEvent.click(more)
    expect(screen.queryByRole('menuitem', { name: /更新故事档案/ })).not.toBeInTheDocument()
  } else {
    expect(more).not.toBeInTheDocument()
  }
})
it('single-chapter publication also surfaces the update prompt', async () => {
  open([chapter('first')])
  fireEvent.click(await screen.findByRole('button', { name: '审阅' }))
  fireEvent.click(await screen.findByRole('button', { name: '发布为正式章节' }))
  expect(await screen.findByTestId('memory-update')).toHaveTextContent('book:prompt')
})

it('shows chapter warnings in a batch and keeps publication available after inspection', async () => {
  open([{ ...chapter('first'), quality: assessWritingQuality({ text: '正文', targetWords: 2000 }) }, chapter('second')])
  expect(await screen.findByText('1 章需检查')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看' }))
  expect(screen.getByRole('list', { name: '续写章节目录' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '发布为正式章节' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '审阅第 1 章：新章节' }))
  expect(screen.getByLabelText('生成质量提示')).toHaveTextContent('不足目标')
  expect(screen.getByRole('button', { name: '发布为正式章节' })).toBeEnabled()
})

it('keeps the selected novel in the draft query', async () => {
  mocks.generations.mockResolvedValue({ items: [chapter('first')], total: 1, novelId: 'book' })
  render(<MemoryRouter><AiGenerationsPanel scope="all" status="all" novelId="book" /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: '审阅' })).toBeInTheDocument()
  expect(mocks.generations).toHaveBeenCalledWith(expect.objectContaining({ novelId: 'book' }))
})

it('does not show unrelated drafts when an older server ignores the novel filter', async () => {
  mocks.generations.mockResolvedValue({ items: [{ ...chapter('other'), novelId: 'other', novelTitle: '其他作品' }], total: 1 })
  render(<MemoryRouter><AiGenerationsPanel scope="all" status="all" novelId="book" /></MemoryRouter>)
  expect(await screen.findByText(/当前服务端尚不支持按作品查看草稿/)).toBeInTheDocument()
  expect(screen.queryByText('其他作品')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '审阅' })).not.toBeInTheDocument()
})
