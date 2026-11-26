import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import BookshelfOrganization, { type OrganizedFavorite } from './BookshelfOrganization'
const mocks = vi.hoisted(() => ({ groups: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), edit: vi.fn(), move: vi.fn() }))
vi.mock('@/lib/api', () => ({ shelfOrganizationApi: mocks }))
const books: OrganizedFavorite[] = [
  { novelId:'n1',title:'雨天的书',note:'留给睡前',groupIds:['g1','g2'],organizationVersion:3 },
  { novelId:'n2',title:'另一场相遇',note:'重逢',groupIds:['g2'],organizationVersion:0 },
]
function show(favorites = books) { return render(<BookshelfOrganization favorites={favorites} safeMode disabled={false} mutate={async action => { await action(); return true }} renderBook={b => <span>{b.title}</span>} />) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.groups.mockResolvedValue({ groups:[{ id:'g1',name:'睡前读',count:1 },{ id:'g2',name:'二刷',count:2 }] })
  mocks.edit.mockResolvedValue({ success:true }); mocks.remove.mockResolvedValue({ success:true })
})
it('filters multi-group books and searches private collection notes', async () => {
  show(); await waitFor(() => expect(screen.getByLabelText('私人分组')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('私人分组'),{ target:{ value:'g1' } })
  expect(screen.getByText('雨天的书')).toBeVisible(); expect(screen.queryByText('另一场相遇')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('私人分组'),{ target:{ value:'' } })
  fireEvent.change(screen.getByLabelText('搜索收藏与备注'),{ target:{ value:'重逢' } })
  expect(screen.getByText('另一场相遇')).toBeVisible(); expect(screen.queryByText('雨天的书')).not.toBeInTheDocument()
})
it('stale save errors retain the note draft and current membership selection', async () => {
  mocks.edit.mockRejectedValue(new Error('收藏已在其他页面更新'))
  show(); await waitFor(() => expect(screen.getAllByRole('button',{ name:'分组与收藏理由' })[0]).not.toBeDisabled())
  fireEvent.click(screen.getAllByRole('button',{ name:'分组与收藏理由' })[0]!)
  fireEvent.change(screen.getByLabelText('我的收藏理由'),{ target:{ value:'我的新感受' } })
  fireEvent.click(screen.getByRole('button',{ name:'保存' }))
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith({ novelIds:['n1'],note:'我的新感受',groupIds:['g1','g2'],expectedVersion:3 },'safe'))
  expect(await screen.findByText('收藏已在其他页面更新')).toBeVisible()
  expect(screen.getByLabelText('我的收藏理由')).toHaveValue('我的新感受')
})
it('batch group additions do not replace existing memberships', async () => {
  show(); await waitFor(() => expect(screen.getByLabelText('私人分组')).not.toBeDisabled())
  fireEvent.click(screen.getByLabelText('选择《雨天的书》')); fireEvent.click(screen.getByLabelText('选择《另一场相遇》'))
  fireEvent.change(screen.getByLabelText('批量操作的分组'),{ target:{ value:'g1' } })
  fireEvent.click(screen.getByRole('button',{ name:'加入分组' }))
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith({ novelIds:['n1','n2'],addGroupIds:['g1'] },'safe'))
})
it('deleting a group requires a second explicit action', async () => {
  show(); await waitFor(() => expect(screen.getByRole('button',{ name:'管理分组' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button',{ name:'管理分组' })); fireEvent.click(screen.getAllByRole('button',{ name:'删除' })[0]!)
  expect(mocks.remove).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button',{ name:'确认删除分组' }))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('g1'))
})
