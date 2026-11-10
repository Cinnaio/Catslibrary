import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisReport } from '@shared/novel-analysis'
import NovelAnalysisPanel from './NovelAnalysisPanel'
import { setStorageUser } from '@/lib/storage'

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), create: vi.fn(), source: vi.fn(), edit: vi.fn(), stop: vi.fn(), resume: vi.fn() }))
vi.mock('@/lib/novel-analysis-api', () => ({ novelAnalysisApi: api }))
vi.mock('@/lib/api', () => ({ chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [{ id: 'c1', title: '第一章' }, { id: 'c2', title: '第二章' }] }) }, newOperationId: () => `analysis_${Math.random().toString(36).slice(2)}` }))
vi.mock('@/lib/admin-novel-index', () => ({ loadAdminNovelIndex: vi.fn().mockResolvedValue([{ id: 'book', title: '本书' }, { id: 'other', title: '另一本书' }]) }))
vi.mock('@/components/shared/SearchSelect', () => ({ default: ({ options, value, onChange, disabled, placeholder }: { options: Array<{ value: string; label: string }>; value: string; onChange: (id: string) => void; disabled?: boolean; placeholder?: string }) =>
  <select aria-label={placeholder || '选项'} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>,
}))
const report = (id = 'report', novelId = 'book'): AnalysisReport => ({
  id, novelId, taskId: 'task', status: 'completed', request: { kind: 'plot', startChapterId: 'c1', endChapterId: 'c2', question: '' },
  step: '', error: '', processed: 2, total: 2, chapterCount: 2, revision: 2, edited: false, createdAt: 1, updatedAt: 1,
  content: `${id} 的分析结论 [[S1]] [[S999]]`, originalContent: '模型原稿', sourceChanged: false, notes: [], checkedSourceIds: [],
  sources: [{ id: 'S1', chapterId: 'c1', chapterTitle: '第一章', chapterOrdinal: 1, part: 1, offset: 0, endOffset: 5, revision: 'hash' }],
})
function Navigate() { const go = useNavigate(); return <button onClick={() => go('/admin/ai?sub=analysis&novel=other&report=other-report')}>切书</button> }
const open = (query = 'novel=book&report=report') => render(<MemoryRouter initialEntries={[`/admin/ai?sub=analysis&${query}`]}><Navigate /><NovelAnalysisPanel /></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of Object.values(api)) mock.mockReset()
  sessionStorage.clear(); localStorage.setItem('user_session_marker', 'analysis-test'); setStorageUser('admin')
  api.list.mockResolvedValue({ reports: [report()], hasMore: false })
  api.read.mockImplementation(async (novelId: string, id: string) => report(id, novelId))
  api.source.mockResolvedValue({ ...report().sources[0], text: '生成时的原文' })
})

it('不自动生成，丢失响应后保留同一请求标识，重开页面仍能找回', async () => {
  api.create.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValue({ reportId: 'report', taskId: 'task' })
  const first = open('novel=book')
  const generate = await screen.findByRole('button', { name: '生成分析报告' })
  await waitFor(() => expect(generate).not.toBeDisabled())
  expect(api.create).not.toHaveBeenCalled()
  fireEvent.click(generate)
  await screen.findByText('连接中断')
  const original = api.create.mock.calls[0]
  first.unmount()
  open('novel=book')
  fireEvent.click(await screen.findByRole('button', { name: '重试并找回这次报告' }))
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2))
  expect(api.create.mock.calls[1]).toEqual(original)
  await screen.findByText(/report 的分析结论/)
})

it('切书后的迟到报告不覆盖当前作品', async () => {
  let resolve!: (r: AnalysisReport) => void
  api.read.mockImplementationOnce(() => new Promise<AnalysisReport>(done => { resolve = done }))
  open()
  await waitFor(() => expect(api.read).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '切书' }))
  await screen.findByText(/other-report 的分析结论/)
  await act(async () => resolve({ ...report(), content: '迟到的旧书内容' }))
  expect(screen.queryByText('迟到的旧书内容')).not.toBeInTheDocument()
})

it('引用只链接已知来源并显示快照，未知来源不会伪装成可核对引用', async () => {
  open()
  fireEvent.click(await screen.findByRole('button', { name: '来源 S1：第一章，第 1 段' }))
  await screen.findByText('生成时的原文')
  expect(api.source).toHaveBeenCalledWith('book', 'report', 'S1')
  expect(screen.queryByRole('button', { name: /来源 S999/ })).not.toBeInTheDocument()
})

it('修订冲突保留输入和错误，按最初版本提交', async () => {
  api.edit.mockRejectedValue(new Error('报告已被修改，请重新读取后保存'))
  open()
  fireEvent.click(await screen.findByRole('button', { name: '修订报告' }))
  const editor = screen.getByRole('textbox', { name: '修订报告（Markdown）' })
  fireEvent.change(editor, { target: { value: '我保留的修订' } })
  fireEvent.click(screen.getByRole('button', { name: '保存修订' }))
  await screen.findByText('报告已被修改，请重新读取后保存')
  expect(editor).toHaveValue('我保留的修订')
  expect(api.edit).toHaveBeenCalledWith('book', 'report', '我保留的修订', 2)
  await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2))
  expect(screen.getByText('报告已被修改，请重新读取后保存')).toBeInTheDocument()
})

it('未保存的修订在重开报告后保留，仍绑定原版本', async () => {
  const first = open()
  fireEvent.click(await screen.findByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '尚未保存的批注' } })
  first.unmount()
  api.read.mockResolvedValue({ ...report(), revision: 3, updatedAt: 3, content: '另一个窗口的修订' })
  open()
  expect(await screen.findByRole('textbox', { name: '修订报告（Markdown）' })).toHaveValue('尚未保存的批注')
  fireEvent.click(screen.getByRole('button', { name: '已核对，继续修订当前版本' }))
  fireEvent.click(screen.getByRole('button', { name: '保存修订' }))
  await waitFor(() => expect(api.edit).toHaveBeenCalledWith('book', 'report', '尚未保存的批注', 3))
})
