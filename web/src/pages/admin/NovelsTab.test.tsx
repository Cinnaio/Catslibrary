import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), toast: vi.fn() }))
vi.mock('../../lib/api', () => ({ adminApi: {}, novelsApi: { list: mocks.list, update: mocks.update }, authHeaders: () => ({}), url: (x: string) => x, newOperationId: () => 'test' }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }))
vi.mock('../../components/admin/CustomSelect', () => ({ default: ({ options, value, onChange, ...props }: any) => <select aria-labelledby={props['aria-labelledby']} value={value} onChange={e => onChange(e.target.value)}>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
vi.mock('../../components/admin/BookImportDialog', () => ({ default: () => null }))
import NovelsTab from './NovelsTab'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({ novels: [{ id: 'n', title: '测试书', author: '原作者', contentRating: 'general', contentRatingRevision: 7, categories: [] }], total: 1, totalPages: 1 })
  mocks.update.mockResolvedValue({})
})
async function open() {
  render(<MemoryRouter><NovelsTab /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑：测试书' }))
}
it('只修改作者不发送旧分级，不覆盖并发审核结果', async () => {
  await open()
  fireEvent.change(screen.getByLabelText('作者'), { target: { value: '新作者' } })
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalled())
  expect(mocks.update.mock.calls[0]![1]).not.toHaveProperty('contentRating')
  expect(mocks.update.mock.calls[0]![1]).toMatchObject({ author: '新作者' })
})
it('修改分级携带打开弹窗时的真实修订号，冲突时保留弹窗和草稿', async () => {
  mocks.update.mockRejectedValueOnce(new Error('作品分级已被其他管理员修改'))
  await open()
  fireEvent.change(screen.getByLabelText('内容分级'), { target: { value: 'restricted' } })
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('n', expect.objectContaining({ contentRating: 'restricted', contentRatingRevision: 7 })))
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('分级已被其他管理员修改'), 'error'))
  expect(screen.getByLabelText('内容分级')).toHaveValue('restricted')
})
