import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NovelVisibilityField from './NovelVisibilityField'
import NovelEditorDialog from './NovelEditorDialog'
import { MemoryRouter } from 'react-router-dom'
import type { Novel } from '@shared/types'

const mocks = vi.hoisted(() => ({ visibility: vi.fn(), accessUsers: vi.fn(), update: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/api', () => ({ novelsApi: mocks }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn() }) }))
vi.mock('./CustomSelect', () => ({ default: (props: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; 'aria-labelledby': string }) =>
  <select aria-labelledby={props['aria-labelledby']} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
    {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}))
const user = { id: 'reader', username: 'reader', displayName: '授权读者', status: 'active' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.visibility.mockResolvedValue({ visibility: 'selected', revision: 7, users: [user], audit: [] })
  mocks.accessUsers.mockResolvedValue({ users: [user], total: 1 })
  mocks.update.mockResolvedValue({})
})
describe('可见范围编辑', () => {
  it('加载授权用户与版本，切换公开时清空提交的授权列表', async () => {
    const onChange = vi.fn()
    render(<NovelVisibilityField novelId="book" onChange={onChange} disabled={false} />)
    await screen.findByText('管理员始终可见', { exact: false })
    expect(onChange).toHaveBeenLastCalledWith({ visibility: 'selected', allowedUserIds: ['reader'], visibilityRevision: 7 })
    fireEvent.change(screen.getByLabelText('可见范围'), { target: { value: 'public' } })
    expect(onChange).toHaveBeenLastCalledWith({ visibility: 'public', allowedUserIds: [], visibilityRevision: 7 })
  })
  it('用户搜索可多选与移除，搜索失败保留已选授权', async () => {
    const onChange = vi.fn()
    render(<NovelVisibilityField onChange={onChange} disabled={false} />)
    fireEvent.change(await screen.findByLabelText('可见范围'), { target: { value: 'selected' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: /授权读者/ }))
    expect(onChange).toHaveBeenLastCalledWith({ visibility: 'selected', allowedUserIds: ['reader'], visibilityRevision: 0 })
    mocks.accessUsers.mockRejectedValueOnce(new Error('offline'))
    fireEvent.change(screen.getByLabelText('添加授权用户'), { target: { value: 'missing' } })
    await screen.findByText('用户列表加载失败，请重试。')
    expect(screen.getByRole('button', { name: '移除授权 reader' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '移除授权 reader' }))
    expect(onChange).toHaveBeenLastCalledWith({ visibility: 'selected', allowedUserIds: [], visibilityRevision: 0 })
  })
  it('授权加载失败时禁止保存；重试恢复后随元数据一并提交', async () => {
    mocks.visibility.mockRejectedValueOnce(new Error('offline'))
    const editing = { id: 'book', title: '测试书', author: '作者', contentRating: 'general', categories: [] } as unknown as Novel
    render(<MemoryRouter><NovelEditorDialog open editing={editing} existingNovels={[]} onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>)
    await screen.findByText('可见范围加载失败，请重试后保存。')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('book', expect.objectContaining({ visibility: 'selected', allowedUserIds: ['reader'], visibilityRevision: 7 })))
  })
})
