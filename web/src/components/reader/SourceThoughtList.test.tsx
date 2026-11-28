import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ThoughtPanel from './ThoughtPanel'
import SourceThoughtList from './SourceThoughtList'
const fetchPage = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useSourceThoughts', () => ({ sourceThoughtPage: fetchPage }))
const anchor = { chapterId: 'chapter', paragraphIndex: 0, paragraphHash: 'hash' }
const item = (id: string, text: string, replyCount = 0) => ({
  id,
  text,
  replyCount,
  displayName: '来源读者',
  avatarUrl: '',
  images: [],
  createdAt: 1000,
  likeCount: 2,
})
beforeEach(() => {
  fetchPage.mockReset()
})
it('切换来源保留本站草稿，来源失败不影响本站发布', async () => {
  fetchPage.mockRejectedValue(new Error('unavailable'))
  const submit = vi.fn().mockResolvedValue(undefined)
  render(
    <ThoughtPanel
      open
      thoughts={[]}
      selectedText=""
      paragraphExcerpt="窗边的雨"
      canDelete={() => false}
      onClose={vi.fn()}
      onSubmit={submit}
      onDelete={vi.fn()}
      sourceAnchor={anchor}
      sourceState={{
        data: { available: true, source: { id: 'fanqie', label: '番茄' }, paragraphs: [], unmatchedCount: 0 },
        loading: false,
        error: '',
        retry: vi.fn(),
      }}
    />,
  )
  await screen.findByText('来源想法暂时无法加载，本站想法仍可使用')
  fireEvent.change(screen.getByRole('textbox', { name: '想法内容' }), { target: { value: '雨声很温柔' } })
  fireEvent.click(screen.getByRole('button', { name: '本站' }))
  fireEvent.click(screen.getByRole('button', { name: '番茄' }))
  expect(screen.getByRole('textbox', { name: '想法内容' })).toHaveValue('雨声很温柔')
  fireEvent.click(screen.getByRole('button', { name: '发布到本站' }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith('雨声很温柔', ''))
})
it('段评翻页去重，来源回复只读展开', async () => {
  fetchPage.mockImplementation(async (_a, cursor, commentId) =>
    commentId
      ? { items: [item('reply', '原平台回复')], total: 1, cursor: '1', hasMore: false }
      : cursor
        ? { items: [item('a', '第一条', 1), item('b', '第二条')], total: 2, cursor: '2', hasMore: false }
        : { items: [item('a', '第一条', 1)], total: 2, cursor: '1', hasMore: true },
  )
  render(<SourceThoughtList anchor={anchor} label="番茄" />)
  await screen.findByText('第一条')
  fireEvent.click(screen.getByRole('button', { name: '更多番茄想法' }))
  await screen.findByText('第二条')
  expect(screen.getAllByText('第一条')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '查看回复（1）' }))
  await screen.findByText('原平台回复')
  expect(fetchPage).toHaveBeenLastCalledWith(anchor, undefined, 'a', false)
  expect(screen.queryByRole('textbox')).toBeNull()
})
it('卸载后迟到的上一段评论不会出现在新段落', async () => {
  let resolve!: (value: unknown) => void
  fetchPage.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const view = render(<SourceThoughtList key="old" anchor={anchor} label="番茄" />)
  fetchPage.mockResolvedValue({ items: [item('new', '新段评论')], total: 1, cursor: '1', hasMore: false })
  view.rerender(<SourceThoughtList key="new" anchor={{ ...anchor, paragraphIndex: 1 }} label="番茄" />)
  await screen.findByText('新段评论')
  resolve({ items: [item('old', '旧段评论')], total: 1, cursor: '1', hasMore: false })
  await waitFor(() => expect(screen.queryByText('旧段评论')).toBeNull())
})

it('未同步完成的空页显示等待状态，不显示没有评论', async () => {
  fetchPage.mockResolvedValue({ items: [], total: 9, cursor: '0', hasMore: false, sync: { state: 'queued', savedCount: 0, updatedAt: 0, complete: false } })
  render(<SourceThoughtList anchor={anchor} label="番茄" />)
  await screen.findByText('已保存 0 条 · 等待同步')
  expect(screen.queryByText('这一段暂时没有番茄想法。')).toBeNull()
  expect(screen.getByRole('button', { name: '更新来源评论' })).toBeEnabled()
})
it('手动更新替换当前首页并更新已保存评论内容', async () => {
  fetchPage
    .mockResolvedValueOnce({
      items: [item('a', '旧内容')],
      total: 1,
      cursor: '1',
      hasMore: false,
      sync: { state: 'completed', savedCount: 1, updatedAt: 1, complete: true },
    })
    .mockResolvedValueOnce({
      items: [item('a', '更新内容')],
      total: 1,
      cursor: '1',
      hasMore: false,
      sync: { state: 'completed', savedCount: 1, updatedAt: 2, complete: true },
    })
  render(<SourceThoughtList anchor={anchor} label="番茄" />)
  await screen.findByText('旧内容')
  fireEvent.click(screen.getByRole('button', { name: '更新来源评论' }))
  await screen.findByText('更新内容')
  expect(screen.queryByText('旧内容')).toBeNull()
  expect(fetchPage).toHaveBeenLastCalledWith(anchor, '', undefined, true)
})
it('来源暂不可用时保留数据库评论并显示同步状态', async () => {
  fetchPage.mockResolvedValue({
    items: [item('a', '保存的评论')],
    total: 1,
    cursor: '1',
    hasMore: false,
    sync: { state: 'unavailable', savedCount: 1, updatedAt: 1, complete: false },
  })
  render(<SourceThoughtList anchor={anchor} label="番茄" />)
  await screen.findByText('保存的评论')
  expect(screen.getByText(/已保存 1 条 · 来源暂不可用/)).toBeInTheDocument()
})
