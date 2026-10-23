import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import AiGenerationsPanel from './AiGenerationsPanel'
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
function open(items: ReturnType<typeof chapter>[]) {
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
  open([chapter('first', 'published'), chapter('second', 'published')])
  fireEvent.click(await screen.findByRole('button', { name: '一键更新情节与关系' }))
  expect(screen.getByTestId('memory-update')).toHaveTextContent('book:start')
})
it('unpublished drafts have no formal-memory update action', async () => {
  open([chapter('first')])
  await screen.findByRole('button', { name: '审阅' })
  expect(screen.queryByRole('button', { name: '一键更新情节与关系' })).not.toBeInTheDocument()
})
it('single-chapter publication also surfaces the update prompt', async () => {
  open([chapter('first')])
  fireEvent.click(await screen.findByRole('button', { name: '审阅' }))
  fireEvent.click(await screen.findByRole('button', { name: '发布为正式章节' }))
  expect(await screen.findByTestId('memory-update')).toHaveTextContent('book:prompt')
})
