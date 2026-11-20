import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import GenerationAssociationDialog from './GenerationAssociationDialog'

const mocks = vi.hoisted(() => ({ index: vi.fn(), preview: vi.fn(), confirm: vi.fn(), applied: vi.fn(), close: vi.fn() }))
vi.mock('@/lib/admin-novel-index', () => ({ loadAdminNovelIndex: mocks.index }))
vi.mock('@/lib/api', () => ({ aiApi: { previewGenerationAssociation: mocks.preview, confirmGenerationAssociation: mocks.confirm }, newOperationId: () => 'same-operation' }))
const preview = { revision: 'revision', target: { novelId: 'target', title: '重新入库的书', author: '作者甲', sourceUrl: '' }, selectedCount: 1, additionalCount: 1, batchRemainderCount: 1,
  items: [{ id: 'one', title: '雨夜', source: { novelId: 'old', title: '原书名', author: '作者甲', sourceUrl: '' } }, { id: 'two', title: '次日', source: { novelId: 'old', title: '原书名', author: '作者甲', sourceUrl: '' } }] }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.index.mockResolvedValue([{ id: 'target', title: '重新入库的书', author: '作者甲', chapterCount: 20 }])
  mocks.preview.mockResolvedValue(preview)
  mocks.confirm.mockResolvedValue({ novelId: 'target', count: 2 })
})
async function open() {
  render(<GenerationAssociationDialog ids={['one']} onClose={mocks.close} onApplied={mocks.applied} />)
  await waitFor(() => expect(screen.getByRole('combobox', { name: '关联到作品' })).toBeEnabled())
  await userEvent.click(screen.getByRole('combobox', { name: '关联到作品' }))
  await userEvent.click(await screen.findByRole('option', { name: /重新入库的书/ }))
}
it('requires explicit preview before confirmation and shows both source and target with batch expansion', async () => {
  await open()
  expect(screen.queryByRole('button', { name: /确认关联/ })).not.toBeInTheDocument()
  expect(mocks.confirm).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '预览关联' }))
  expect(await screen.findByText('关联到《重新入库的书》')).toBeInTheDocument()
  expect(screen.getByText('所选 1 条，另含同批次 1 条，共 2 条待审草稿。')).toBeInTheDocument()
  expect(screen.getAllByText(/原作品：原书名/)).toHaveLength(2)
  await userEvent.click(screen.getByRole('button', { name: '确认关联 2 条草稿' }))
  expect(mocks.confirm).toHaveBeenCalledWith({ ids: ['one'], novelId: 'target', includeBatch: true, revision: 'revision' }, 'same-operation')
  expect(mocks.applied).toHaveBeenCalledWith('target', 2)
})
it('invalidates the preview after changing batch scope', async () => {
  await open()
  await userEvent.click(screen.getByRole('button', { name: '预览关联' }))
  await screen.findByRole('button', { name: '确认关联 2 条草稿' })
  await userEvent.click(screen.getByRole('checkbox', { name: '同时处理所属批次的其他失联待审草稿' }))
  expect(screen.queryByRole('button', { name: /确认关联/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '预览关联' }))
  expect(mocks.preview).toHaveBeenLastCalledWith({ ids: ['one'], novelId: 'target', includeBatch: false })
})
it('keeps the preview and operation ID on uncertain confirmation so a retry cannot duplicate the repair', async () => {
  mocks.confirm.mockRejectedValueOnce(new Error('网络中断，请重试'))
  await open()
  await userEvent.click(screen.getByRole('button', { name: '预览关联' }))
  await userEvent.click(await screen.findByRole('button', { name: '确认关联 2 条草稿' }))
  expect(await screen.findByText('网络中断，请重试')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '确认关联 2 条草稿' }))
  expect(mocks.confirm.mock.calls.map(call => call[1])).toEqual(['same-operation', 'same-operation'])
  expect(mocks.applied).toHaveBeenCalledTimes(1)
})
