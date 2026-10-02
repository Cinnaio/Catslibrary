import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ index: vi.fn(), list: vi.fn(), get: vi.fn(), update: vi.fn(), toast: vi.fn() }))
vi.mock('../../lib/api', () => ({ adminApi: { novelIndex: mocks.index }, chaptersApi: { list: mocks.list, get: mocks.get, update: mocks.update }, scrapeApi: {}, newOperationId: () => 'test' }))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn() }) }))
vi.mock('../../components/admin/CustomSelect', () => ({ default: ({ options, onChange }: any) => <select aria-label="选择小说" onChange={e => onChange(e.target.value)}><option value="" />{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
import ChaptersTab from './ChaptersTab'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.index.mockResolvedValue({ novels: [{ id: 'n', title: '测试书', author: '', chapterCount: 1 }] })
  mocks.list.mockResolvedValue({ chapters: [{ id: 'c', novelId: 'n', title: '原章', order: 1, wordCount: 3, createdAt: 1 }] })
  mocks.update.mockResolvedValue({})
})
async function open() {
  render(<ChaptersTab />)
  await screen.findByRole('option', { name: '测试书' })
  fireEvent.change(screen.getByLabelText('选择小说'), { target: { value: 'n' } })
  fireEvent.click(await screen.findByRole('button', { name: '编辑：第1章 原章' }))
}
it('正文加载失败后禁止保存，不能覆盖原文', async () => {
  mocks.get.mockRejectedValue(new Error('offline'))
  await open()
  await waitFor(() => expect(mocks.get).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('加载中…')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /^保存$/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  expect(mocks.update).not.toHaveBeenCalled()
})
it('成功加载后允许有意清空正文并保存', async () => {
  mocks.get.mockResolvedValue({ chapter: { content: '原正文' } })
  await open()
  const content = await screen.findByPlaceholderText('章节正文…')
  await waitFor(() => expect(content).toHaveValue('原正文'))
  fireEvent.change(content, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('c', { novelId: 'n', title: '原章', content: '', order: 1 }))
})
