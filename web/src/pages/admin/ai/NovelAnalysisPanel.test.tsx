import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisReport } from '@shared/novel-analysis'
import NovelAnalysisPanel from './NovelAnalysisPanel'
import { setStorageUser } from '@/lib/storage'
import { analysisPendingKey, readAnalysisDraft, savePendingAnalysisReview } from './analysis-request-state'

const providers = vi.hoisted(() => ({ providerPresets: vi.fn(), status: vi.fn() }))
const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), create: vi.fn(), source: vi.fn(), edit: vi.fn(), stop: vi.fn(), resume: vi.fn(), delete: vi.fn() }))
vi.mock('@/lib/novel-analysis-api', () => ({ novelAnalysisApi: api }))
vi.mock('@/lib/api', () => ({ aiApi: providers, chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [{ id: 'c1', title: '第一章' }, { id: 'c2', title: '第二章' }] }) }, newOperationId: () => `analysis_${Math.random().toString(36).slice(2)}` }))
vi.mock('@/components/shared/SearchSelect', () => ({ default: ({ options, value, onChange, disabled, placeholder }: { options: Array<{ value: string; label: string; disabled?: boolean }>; value: string; onChange: (id: string) => void; disabled?: boolean; placeholder?: string }) =>
  <select aria-label={placeholder || '选项'} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select>,
}))
const report = (id = 'report', novelId = 'book'): AnalysisReport => ({
  id, novelId, taskId: 'task', status: 'completed', request: { kind: 'plot', startChapterId: 'c1', endChapterId: 'c2', question: '' },
  step: '', error: '', processed: 2, total: 2, chapterCount: 2, revision: 2, edited: false, createdAt: 1, updatedAt: 1,
  content: `${id} 的分析结论 [[S1]] [[S999]]`, originalContent: '模型原稿', sourceChanged: false, notes: [], checkedSourceIds: [],
  sources: [{ id: 'S1', chapterId: 'c1', chapterTitle: '第一章', chapterOrdinal: 1, part: 1, offset: 0, endOffset: 5, revision: 'hash' }],
})
function Navigate() { const go = useNavigate(); return <button onClick={() => go('/admin/ai?sub=analysis&novel=other&report=other-report')}>切书</button> }
function AnalysisRoute() {
  const [params, setParams] = useSearchParams()
  return <NovelAnalysisPanel novelId={params.get('novel') || ''} reportId={params.get('report') || ''}
    onSelectReport={id => setParams(current => { const next = new URLSearchParams(current); next.set('report', id); return next })} />
}
const open = (query = 'novel=book&report=report') => render(<MemoryRouter initialEntries={[`/admin/ai?sub=analysis&${query}`]}><Navigate /><AnalysisRoute /></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of Object.values(api)) mock.mockReset()
  providers.providerPresets.mockReset().mockResolvedValue({ presets: [
    { id: 'primary', name: '主模型', model: 'model-a', scope: 'text', hasApiKey: true },
    { id: 'backup', name: '备用模型', model: 'model-b', scope: 'text', hasApiKey: true },
    { id: 'image', name: '绘图模型', model: 'image-a', scope: 'image', hasApiKey: true },
    { id: 'empty', name: '无密钥模型', model: 'empty', scope: 'text', hasApiKey: false },
  ] })
  providers.status.mockReset().mockResolvedValue({ model: 'default-model' })
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


it('复用已有分析时打开报告并说明没有重复生成', async () => {
  api.create.mockResolvedValue({ reportId: 'report', taskId: 'task', created: false, reused: true })
  open('novel=book')
  const generate = await screen.findByRole('button', { name: '生成分析报告' })
  await waitFor(() => expect(generate).not.toBeDisabled())
  fireEvent.click(generate)
  await screen.findByText('已打开相同分析，复用已有报告或正在进行的任务，本次未重复生成。')
  expect(api.create).toHaveBeenCalledTimes(1)
  expect(api.create.mock.calls[0]![3]).toBe(false)
  await screen.findByText(/report 的分析结论/)
})

it('强制重新分析在断流和重开页面后保留同一次请求及复用选择', async () => {
  api.create.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValue({ reportId: 'fresh', taskId: 'task', created: true, reused: false })
  const first = open('novel=book')
  const checkbox = await screen.findByRole('checkbox', { name: '重新分析，不使用已有报告和阅读底稿' })
  fireEvent.click(checkbox)
  const generate = screen.getByRole('button', { name: '重新生成分析报告' })
  await waitFor(() => expect(generate).not.toBeDisabled())
  fireEvent.click(generate)
  await screen.findByText('连接中断')
  const original = api.create.mock.calls[0]
  expect(original![3]).toBe(true)
  first.unmount()
  open('novel=book')
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重试并找回这次报告' }))
  await screen.findByText(/fresh 的分析结论/)
  expect(api.create.mock.calls[1]).toEqual(original)
  expect(screen.getByRole('checkbox')).not.toBeChecked()
})

it('从报告重新分析会选中重做选项并显示复用段数', async () => {
  api.read.mockResolvedValue({ ...report(), reusedSources: 2 })
  open()
  await screen.findByText('本次复用了 2 段阅读底稿，原文依据仍可逐条核对。')
  HTMLElement.prototype.scrollIntoView = vi.fn()
  fireEvent.click(screen.getByRole('button', { name: '按此范围新建报告' }))
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByRole('button', { name: '重新生成分析报告' })).toBeEnabled()
  expect(api.create).not.toHaveBeenCalled()
})


it('阅读满额而整理失败时显示准确阶段，不显示满格报告进度', async () => {
  const failed = { ...report(), content: '', status: 'failed' as const, phase: 'condensing' as const,
    step: '整理记录未完成，阅读记录已保留', error: '整理记录已达到输出上限（6000 tokens）',
    notes: [{ sourceIds: ['S1'], content: '保存的原始阅读记录' }] }
  api.read.mockResolvedValue(failed)
  open()
  await screen.findByText('整理记录未完成，阅读记录已保留')
  expect(screen.getByRole('list', { name: '分析阶段' })).toHaveTextContent('1. 阅读原文已完成2. 整理记录未完成3. 生成报告待完成')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText(/阅读完成，最终报告尚未生成/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续分析' })).toBeEnabled()
})
it('旧任务缺少阶段信息时不把满额阅读误报为报告完成', async () => {
  api.read.mockResolvedValue({ ...report(), content: '', status: 'failed', phase: undefined, error: '本次输出未完成' })
  open()
  await screen.findByText('本次输出未完成')
  expect(screen.getByRole('list', { name: '分析阶段' })).toHaveTextContent('1. 阅读原文已完成2. 整理记录待完成3. 生成报告待完成')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})


it('删除先确认，取消不发请求并保留修订草稿', async () => {
  open()
  fireEvent.click(await screen.findByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '待保存的修订' } })
  fireEvent.click(screen.getByRole('button', { name: '删除报告' }))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('删除后无法恢复')
  expect(dialog).toHaveTextContent('本地尚未保存的修订也会清除')
  expect(dialog).toHaveTextContent('第一章 — 第一章')
  expect(api.delete).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '修订报告（Markdown）' })).toHaveValue('待保存的修订')
})

it('确认删除后清除选中报告、修订与待核查缓存，并刷新历史', async () => {
  open()
  fireEvent.click(await screen.findByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '要清除的草稿' } })
  const key = analysisPendingKey('book')
  savePendingAnalysisReview(`${key}:review:report`, { requestId: 'review-pending', revision: 2 })
  api.list.mockResolvedValue({ reports: [], hasMore: false })
  fireEvent.click(screen.getByRole('button', { name: '删除报告' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
  await screen.findByText('分析报告已删除。')
  await screen.findByText('还没有分析报告。')
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('book', 'report')
  expect(readAnalysisDraft(`${key}:draft:report`)).toBeNull()
  expect(sessionStorage.getItem(`${key}:review:report`)).toBeNull()
  await waitFor(() => expect(screen.queryByRole('article', { name: '分析报告' })).not.toBeInTheDocument())
  expect(api.read).toHaveBeenCalledTimes(1)
  expect(api.list).toHaveBeenLastCalledWith('book', 0)
})

it('删除失败保留弹窗和草稿，删除进行中禁止重复点击', async () => {
  let reject!: (error: Error) => void
  api.delete.mockReturnValue(new Promise((_resolve, failure) => { reject = failure }))
  open()
  fireEvent.click(await screen.findByRole('button', { name: '修订报告' }))
  fireEvent.change(screen.getByRole('textbox', { name: '修订报告（Markdown）' }), { target: { value: '失败时保留的草稿' } })
  fireEvent.click(screen.getByRole('button', { name: '删除报告' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
  expect(screen.getByRole('button', { name: '正在删除…' })).toBeDisabled()
  expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' })).toBeDisabled()
  await act(async () => reject(new Error('暂时无法删除')))
  expect(await screen.findByRole('alert')).toHaveTextContent('删除失败：暂时无法删除')
  expect(screen.getByRole('button', { name: '确认删除' })).toBeEnabled()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
  expect(screen.getByRole('textbox', { name: '修订报告（Markdown）' })).toHaveValue('失败时保留的草稿')
  expect(readAnalysisDraft(`${analysisPendingKey('book')}:draft:report`)?.content).toBe('失败时保留的草稿')
  expect(api.delete).toHaveBeenCalledTimes(1)
})

it('删除末页最后一条报告后回到第一页，忽略删除前迟到的历史读取', async () => {
  let resolveHistory!: (value: { reports: AnalysisReport[]; hasMore: boolean }) => void
  const last = { ...report('last'), chapterCount: 7 }
  api.list.mockResolvedValueOnce({ reports: [report()], hasMore: true })
    .mockResolvedValueOnce({ reports: [last], hasMore: false })
    .mockReturnValueOnce(new Promise(resolve => { resolveHistory = resolve }))
    .mockResolvedValue({ reports: [report()], hasMore: false })
  open()
  fireEvent.click(await screen.findByRole('button', { name: '下一页' }))
  await waitFor(() => expect(api.list).toHaveBeenCalledWith('book', 20))
  await waitFor(() => expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled())
  fireEvent.click(within(screen.getByRole('complementary', { name: '历史分析报告' })).getByRole('button', { name: /情节分析/ }))
  await screen.findByText(/last 的分析结论/)
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  fireEvent.click(screen.getByRole('button', { name: '删除报告' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }))
  await screen.findByText('分析报告已删除。')
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('book', 0))
  await act(async () => resolveHistory({ reports: [last], hasMore: false }))
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  expect(screen.queryByText(/last 的分析结论/)).not.toBeInTheDocument()
  expect(within(screen.getByRole('complementary', { name: '历史分析报告' })).queryByText(/7 章/)).not.toBeInTheDocument()
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('book', 'last')
})

it('未完成报告也能删除，重试遇到已被删除的报告时清理页面', async () => {
  api.read.mockResolvedValue({ ...report(), content: '', status: 'running', phase: 'reading' })
  api.delete.mockRejectedValue(Object.assign(new Error('报告不存在'), { status: 404 }))
  api.list.mockResolvedValue({ reports: [], hasMore: false })
  open()
  fireEvent.click(await screen.findByRole('button', { name: '删除报告' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('进行中的分析与核查会停止')
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await screen.findByText('分析报告已删除。')
  await waitFor(() => expect(screen.queryByRole('article', { name: '分析报告' })).not.toBeInTheDocument())
})

it('删除响应晚于切书时不清空新书选中报告', async () => {
  let resolveDelete!: () => void
  api.delete.mockReturnValue(new Promise<void>(resolve => { resolveDelete = resolve }))
  open()
  fireEvent.click(await screen.findByRole('button', { name: '删除报告' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  fireEvent.click(screen.getByText('切书'))
  await screen.findByText(/other-report 的分析结论/)
  await act(async () => resolveDelete())
  expect(screen.getByText(/other-report 的分析结论/)).toBeInTheDocument()
  expect(screen.queryByText('分析报告已删除。')).not.toBeInTheDocument()
})


it('删除成功后迟到轮询结果不会重新显示报告或继续轮询', async () => {
  let resolveRead!: (value: AnalysisReport) => void
  api.read.mockResolvedValueOnce({ ...report(), content: '', status: 'running', phase: 'reading' })
    .mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve }))
  api.list.mockResolvedValue({ reports: [], hasMore: false })
  open()
  await screen.findByRole('button', { name: '删除报告' })
  await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2), { timeout: 4000 })
  fireEvent.click(screen.getByRole('button', { name: '删除报告' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(screen.queryByRole('article', { name: '分析报告' })).not.toBeInTheDocument())
  await act(async () => resolveRead(report()))
  expect(screen.queryByText(/report 的分析结论/)).not.toBeInTheDocument()
  expect(api.read).toHaveBeenCalledTimes(2)
})


it('新建分析使用文本预设，切换本身不生成且断流重试保留原选择', async () => {
  api.create.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValue({ reportId: 'report', taskId: 'task' })
  const first = open('novel=book')
  const choice = await screen.findByRole('combobox', { name: '分析模型预设' })
  await screen.findByRole('option', { name: '备用模型 · model-b' })
  expect(screen.queryByRole('option', { name: /绘图模型/ })).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: '无密钥模型 · empty' })).toBeDisabled()
  fireEvent.change(choice, { target: { value: 'backup' } })
  expect(api.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '生成分析报告' }))
  await screen.findByText('连接中断')
  const original = api.create.mock.calls[0]!
  expect(original[4]).toBe('backup')
  expect(choice).toBeDisabled()
  first.unmount()
  open('novel=book')
  const restored = screen.getByRole('combobox', { name: '分析模型预设' })
  expect(restored).toHaveValue('backup')
  expect(restored).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重试并找回这次报告' }))
  await screen.findByText(/report 的分析结论/)
  expect(api.create.mock.calls[1]).toEqual(original)
})

it('失败报告默认选中上次预设，改用备用模型后显式继续并保留阅读记录', async () => {
  api.read.mockResolvedValue({ ...report(), content: '', status: 'failed', providerPresetId: 'primary', model: 'model-a',
    notes: [{ sourceIds: ['S1'], content: '已经阅读的记录' }], phase: 'report' })
  open()
  const choice = await screen.findByRole('combobox', { name: '继续分析模型预设' })
  await screen.findByText('本次分析模型：model-a')
  await waitFor(() => expect(choice).toHaveValue('primary'))
  fireEvent.change(choice, { target: { value: 'backup' } })
  expect(api.resume).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '继续分析' }))
  await waitFor(() => expect(api.resume).toHaveBeenCalledExactlyOnceWith('book', 'report', 'backup'))
  expect(screen.getByText('已经阅读的记录')).toBeInTheDocument()
})

it('运行中不提供换模续跑入口，旧报告没有模型信息时跟随默认', async () => {
  api.read.mockResolvedValue({ ...report(), content: '', status: 'running', model: 'model-a', providerPresetId: 'primary' })
  const first = open()
  await screen.findByRole('button', { name: '停止分析' })
  expect(screen.queryByRole('combobox', { name: '继续分析模型预设' })).not.toBeInTheDocument()
  first.unmount()
  api.read.mockResolvedValue({ ...report(), content: '', status: 'failed' })
  open()
  expect(await screen.findByRole('combobox', { name: '继续分析模型预设' })).toHaveValue('__default__')
  fireEvent.click(screen.getByRole('button', { name: '继续分析' }))
  await waitFor(() => expect(api.resume).toHaveBeenCalledWith('book', 'report', ''))
})

it('原预设失效或列表加载失败时不静默改用默认，刷新可恢复候选', async () => {
  providers.providerPresets.mockRejectedValue(new Error('列表离线'))
  api.read.mockResolvedValue({ ...report(), content: '', status: 'failed', model: 'old-model', providerPresetId: 'missing' })
  open()
  const choice = await screen.findByRole('combobox', { name: '继续分析模型预设' })
  await waitFor(() => expect(within(choice).getByRole('option', { name: '原预设不可用，请重新选择' })).toBeDisabled())
  expect(choice).toHaveValue('missing')
  expect(api.resume).not.toHaveBeenCalled()
  providers.providerPresets.mockResolvedValue({ presets: [{ id: 'backup', name: '备用', model: 'model-b', scope: 'text', hasApiKey: true }] })
  fireEvent.click(screen.getByRole('button', { name: '刷新继续分析模型预设' }))
  await within(choice).findByRole('option', { name: '备用 · model-b' })
  expect(choice).toHaveValue('missing')
  fireEvent.change(choice, { target: { value: 'backup' } })
  fireEvent.click(screen.getByRole('button', { name: '继续分析' }))
  await waitFor(() => expect(api.resume).toHaveBeenCalledWith('book', 'report', 'backup'))
})


it('失败报告展示已保存小节和目录，来源可核对，继续后完整报告替换草稿', async () => {
  const partial: AnalysisReport = { ...report(), status: 'failed', content: '', originalContent: '', phase: 'report',
    step: '生成报告未完成，阅读记录与已完成小节已保留', error: '第二节暂时超时',
    draft: { version: 1, overview: '共同概览', review: 'pending', sections: [
      { id: '1', title: '信任变化', focus: '信任', sourceIds: ['S1'], depth: 0, content: '已经保存的关系变化 [[S1]]' },
      { id: '2', title: '后续约定', focus: '计划', sourceIds: ['S1'], depth: 0, content: '' },
    ] } }
  api.read.mockResolvedValue(partial)
  api.resume.mockImplementation(async () => { api.read.mockResolvedValue({ ...report(), content: '核对后的完整报告 [[S1]]' }); return { reportId: 'report', taskId: 'resumed' } })
  open()
  await screen.findByText('已完成 1 / 2 节')
  const draft = screen.getByRole('region', { name: '分节报告草稿' })
  expect(within(draft).getByText('2. 后续约定')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '修订报告' })).not.toBeInTheDocument()
  fireEvent.click(within(draft).getByText('1. 信任变化'))
  expect(within(draft).getByText(/已经保存的关系变化/)).toBeInTheDocument()
  fireEvent.click(within(draft).getByRole('button', { name: '来源 S1：第一章，第 1 段' }))
  await screen.findByText('生成时的原文')
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '继续分析' }))
  await screen.findByText(/核对后的完整报告/)
  expect(api.resume).toHaveBeenCalledWith('book', 'report', '')
  expect(screen.queryByRole('region', { name: '分节报告草稿' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '修订报告' })).toBeInTheDocument()
})

it('全部小节已保存而跨节核对失败时，仍明确显示草稿与可继续状态', async () => {
  api.read.mockResolvedValue({ ...report(), status: 'failed', content: '', originalContent: '', phase: 'report', error: '核对超时',
    draft: { version: 1, overview: '概览', review: 'pending', sections: [
      { id: '1', title: '关系概览', focus: '关系', sourceIds: ['S1'], depth: 0, content: '已保存的小节正文' },
    ] } })
  open()
  await screen.findByText('已完成 1 / 1 节')
  expect(screen.getByText(/小节已全部保存，跨节核对尚未完成/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续分析' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '修订报告' })).not.toBeInTheDocument()
})
