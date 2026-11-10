import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisReport } from '@shared/novel-analysis'
import { setStorageUser } from '@/lib/storage'
import AiTab from '../AiTab'

const api = vi.hoisted(() => ({
  list: vi.fn(), read: vi.fn(), create: vi.fn(), source: vi.fn(), edit: vi.fn(), stop: vi.fn(), resume: vi.fn(),
  index: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/lib/novel-analysis-api', () => ({ novelAnalysisApi: api }))
vi.mock('@/lib/admin-novel-index', () => ({ loadAdminNovelIndex: api.index }))
vi.mock('@/lib/api', () => ({
  aiApi: { settings: vi.fn().mockResolvedValue({ provider: null }) },
  chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [{ id: 'c1', title: '第一章' }, { id: 'c2', title: '第二章' }] }) },
  newOperationId: () => 'analysis-operation',
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: api.toast }) }))
vi.mock('./AiAgentPanel', () => ({ default: () => null }))
vi.mock('./AiCoverPanel', () => ({ default: () => null }))
vi.mock('./StoryGraphPanel', () => ({ default: () => null }))
vi.mock('./AiGenerationsPanel', () => ({ default: () => null }))
vi.mock('./AiWritingPanel', () => ({
  default: function Writing({ novelId }: { novelId: string }) {
    const [draft, setDraft] = useState('')
    return <div><span>创作对象：{novelId}</span><textarea aria-label="构思草稿" value={draft} onChange={e => setDraft(e.target.value)} /></div>
  },
}))
vi.mock('@/components/shared/SearchSelect', () => ({ default: (props: {
  options: Array<{ value: string; label: string }>; value: string; onChange: (id: string) => void
  disabled?: boolean; placeholder?: string; 'aria-labelledby'?: string
}) => <select aria-labelledby={props['aria-labelledby']} aria-label={props['aria-labelledby'] ? undefined : props.placeholder || '选项'}
  value={props.value} disabled={props.disabled} onChange={e => props.onChange(e.target.value)}>
  <option value="">请选择</option>{props.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
</select> }))

const report = (id = 'report', novelId = 'book'): AnalysisReport => ({
  id, novelId, taskId: 'task', status: 'completed', request: { kind: 'plot', startChapterId: 'c1', endChapterId: 'c2', question: '' },
  step: '', error: '', processed: 2, total: 2, chapterCount: 2, revision: 1, edited: false, createdAt: 1, updatedAt: 1,
  content: `${id} 的分析结论 [[S1]]`, originalContent: '模型原稿', sourceChanged: false, notes: [], checkedSourceIds: [],
  sources: [{ id: 'S1', chapterId: 'c1', chapterTitle: '第一章', chapterOrdinal: 1, part: 1, offset: 0, endOffset: 5, revision: 'hash' }],
})
function RouteControls() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="route">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>后退</button><button onClick={() => navigate(1)}>前进</button></>
}
function open(query: string) {
  return render(<MemoryRouter initialEntries={['/admin/novels', `/admin/ai?${query}`]} initialIndex={1}>
    <RouteControls /><AiTab />
  </MemoryRouter>)
}
function activate(label: string) {
  const tab = screen.getByRole('tab', { name: label })
  act(() => tab.focus())
  fireEvent.keyDown(tab, { key: 'Enter' })
}
function route() { return new URL(screen.getByTestId('route').textContent!, 'https://workspace.local').searchParams }

beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of Object.values(api)) mock.mockReset()
  sessionStorage.clear(); localStorage.clear(); localStorage.setItem('user_session_marker', 'workspace-test'); setStorageUser('admin')
  api.index.mockResolvedValue([{ id: 'book', title: '本书', chapterCount: 2 }, { id: 'other', title: '另一本书', chapterCount: 2 }])
  api.list.mockImplementation(async (novelId: string) => ({ reports: novelId === 'book' ? [report()] : [], hasMore: false }))
  api.read.mockImplementation(async (novelId: string, id: string) => report(id, novelId))
})

it('旧报告链接进入统一工作区，切换与历史往返保留报告修订、分析问题及构思', async () => {
  open('sub=analysis&novel=book&report=report&afterChapterId=c1&batch=batch')
  await screen.findByText(/report 的分析结论/)
  expect(route().get('sub')).toBe('writing')
  expect(route().get('view')).toBe('analysis')
  expect(screen.queryByLabelText('构思草稿')).not.toBeInTheDocument()
  expect(screen.getAllByRole('combobox', { name: '当前作品' })).toHaveLength(1)
  fireEvent.change(screen.getByRole('textbox', { name: '重点关注（选填）' }), { target: { value: '关注人物信任变化' } })
  fireEvent.click(screen.getByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '我的未保存修订' } })
  activate('构思与生成')
  fireEvent.change(screen.getByLabelText('构思草稿'), { target: { value: '渡口重逢' } })
  expect(route().get('report')).toBe('report')
  expect(route().get('afterChapterId')).toBe('c1')
  expect(route().get('batch')).toBe('batch')
  fireEvent.click(screen.getByRole('button', { name: '后退' }))
  expect(await screen.findByRole('textbox', { name: '修订报告（Markdown）' })).toHaveValue('我的未保存修订')
  expect(screen.getByRole('textbox', { name: '重点关注（选填）' })).toHaveValue('关注人物信任变化')
  fireEvent.click(screen.getByRole('button', { name: '前进' }))
  expect(await screen.findByLabelText('构思草稿')).toHaveValue('渡口重逢')
  expect(api.index).toHaveBeenCalledTimes(1)
  expect(api.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '后退' }))
  fireEvent.click(screen.getByRole('button', { name: '后退' }))
  await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/admin/novels'))
})

it('提交分析后继续构思，迟到回执只记录本书报告，不改变当前视图', async () => {
  let resolve!: (value: { reportId: string; taskId: string }) => void
  api.create.mockImplementation(() => new Promise(done => { resolve = done }))
  open('sub=writing&view=analysis&novel=book')
  const generate = await screen.findByRole('button', { name: '生成分析报告' })
  await waitFor(() => expect(generate).toBeEnabled())
  fireEvent.click(generate)
  activate('构思与生成')
  fireEvent.change(screen.getByLabelText('构思草稿'), { target: { value: '等待报告时继续构思' } })
  await act(async () => resolve({ reportId: 'new-report', taskId: 'task' }))
  expect(route().get('view')).toBe('compose')
  expect(route().get('report')).toBe('new-report')
  expect(screen.getByLabelText('构思草稿')).toHaveValue('等待报告时继续构思')
  activate('分析报告')
  await screen.findByText(/new-report 的分析结论/)
  expect(api.create).toHaveBeenCalledTimes(1)
})

it('切书清理报告、批次与续写起点，旧书提交回执不会改变新书地址', async () => {
  let resolve!: (value: { reportId: string; taskId: string }) => void
  api.create.mockImplementation(() => new Promise(done => { resolve = done }))
  open('sub=writing&view=analysis&novel=book&report=report&batch=batch&afterChapterId=c1')
  const generate = await screen.findByRole('button', { name: '生成分析报告' })
  await waitFor(() => expect(generate).toBeEnabled())
  fireEvent.click(generate)
  fireEvent.change(screen.getByRole('combobox', { name: '当前作品' }), { target: { value: 'other' } })
  await waitFor(() => expect(api.list).toHaveBeenCalledWith('other', 0))
  expect(route().get('novel')).toBe('other')
  for (const key of ['report', 'batch', 'afterChapterId']) expect(route().has(key)).toBe(false)
  await act(async () => resolve({ reportId: 'old-book-report', taskId: 'task' }))
  expect(route().get('novel')).toBe('other')
  expect(route().has('report')).toBe(false)
  expect(screen.queryByRole('article', { name: '分析报告' })).not.toBeInTheDocument()
})

it('重新进入分析刷新报告状态，同时保留作者未保存的修订', async () => {
  open('sub=writing&view=analysis&novel=book&report=report')
  fireEvent.click(await screen.findByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '尚未保存' } })
  activate('构思与生成')
  api.read.mockResolvedValue({ ...report(), sourceChanged: true })
  activate('分析报告')
  await screen.findByText(/正文或章节顺序已变化/)
  expect(screen.getByRole('textbox', { name: '修订报告（Markdown）' })).toHaveValue('尚未保存')
  expect(api.create).not.toHaveBeenCalled()
})

it('旧的上次分析入口恢复为空作品工作区，不自动启动分析', async () => {
  localStorage.setItem('ai_active_subtab', 'analysis')
  open('')
  await waitFor(() => expect(route().get('view')).toBe('analysis'))
  expect(screen.getByRole('tab', { name: '分析报告' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('选择作品，从一段章节开始阅读和核对。')).toBeInTheDocument()
  expect(screen.queryByLabelText('构思草稿')).not.toBeInTheDocument()
  expect(api.create).not.toHaveBeenCalled()
})

it('作品索引失败可重试，保留深链作品与报告', async () => {
  api.index.mockRejectedValueOnce(new Error('书目读取失败'))
  open('sub=writing&view=analysis&novel=book&report=report')
  await screen.findByText(/report 的分析结论/)
  fireEvent.click(await screen.findByRole('button', { name: '重新加载书目' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: '当前作品' })).toBeEnabled())
  expect(screen.getByRole('combobox', { name: '当前作品' })).toHaveValue('book')
  expect(route().get('report')).toBe('report')
  expect(api.create).not.toHaveBeenCalled()
})
