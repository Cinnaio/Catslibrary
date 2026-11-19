import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@shared/ai-agent'
const mocks = vi.hoisted(() => ({ chapter: vi.fn(), chapterHistory: vi.fn(), editChapter: vi.fn(), prepare: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/ai-agent-api', () => ({ agentApi: mocks }))
vi.mock('@/lib/api', () => ({ chaptersApi: { list: mocks.list }, newOperationId: () => 'stable-request' }))
vi.mock('@/components/shared/SearchSelect', () => ({ default: (props: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled: boolean }) =>
  <select aria-label="切换原章节" value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.target.value)}>{props.options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }))
import AiAgentChapterEdit from './AiAgentChapterEdit'
const session: AgentSession = { id: 'session', novelId: 'book', novelTitle: '作品', title: '对话', afterChapterId: 'chapter-2', anchorTitle: '第二章', brief: '',
  contentPreferences: { version: 1, adultContentMode: 'off', intimacyWeight: 'none', adultCharactersConfirmed: false }, activeTaskId: '', createdAt: 1, updatedAt: 1 }
const source = { id: 'chapter-2', title: '第二章', content: '前文🙂。她打开门。后文。', revision: 'revision-2' }
const callbacks = { onCreated: vi.fn(), onPrepared: vi.fn() }
async function open() {
  render(<AiAgentChapterEdit session={session} providerPresetId="chosen-model" disabled={false} {...callbacks} />)
  fireEvent.click(screen.getByRole('button', { name: '改写原章节' }))
  await screen.findByLabelText('原文（选中要改写的段落）')
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue({ chapters: [{ id: 'chapter-1', title: '第一章', order: 1 }, { id: 'chapter-2', title: '第二章', order: 2 }, { id: 'future', title: '未来章', order: 3 }] })
  mocks.chapter.mockResolvedValue({ chapter: source })
  mocks.chapterHistory.mockResolvedValue({ history: [], hasMore: false })
  mocks.editChapter.mockResolvedValue({ taskId: 'suggestion' })
})
describe('Agent chapter edit entry', () => {
  it('submits exact UTF-16 selection, authoritative revision and the selected model', async () => {
    await open()
    const textarea = screen.getByLabelText('原文（选中要改写的段落）') as HTMLTextAreaElement
    const start = source.content.indexOf('她打开门。')
    textarea.setSelectionRange(start, start + '她打开门。'.length)
    fireEvent.select(textarea)
    fireEvent.change(screen.getByLabelText('增补或改写要求'), { target: { value: '补充犹豫的动作' } })
    fireEvent.click(screen.getByRole('button', { name: '生成章节建议' }))
    await waitFor(() => expect(callbacks.onCreated).toHaveBeenCalledWith('suggestion'))
    expect(mocks.editChapter).toHaveBeenCalledWith('session', expect.objectContaining({ chapterId: source.id, baseRevision: source.revision,
      startUTF16: start, endUTF16: start + '她打开门。'.length, selectedText: '她打开门。', instruction: '补充犹豫的动作', providerPresetId: 'chosen-model' }))
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('keeps instructions and reuses the request ID after a lost response', async () => {
    mocks.editChapter.mockRejectedValueOnce(new Error('连接中断'))
    await open()
    fireEvent.change(screen.getByLabelText('增补或改写要求'), { target: { value: '保留结局' } })
    fireEvent.click(screen.getByRole('button', { name: '生成章节建议' }))
    await screen.findByText('连接中断')
    expect(screen.getByLabelText('增补或改写要求')).toHaveValue('保留结局')
    fireEvent.click(screen.getByRole('button', { name: '生成章节建议' }))
    await waitFor(() => expect(mocks.editChapter).toHaveBeenCalledTimes(2))
    expect(mocks.editChapter.mock.calls[0]![1]).toEqual(mocks.editChapter.mock.calls[1]![1])
  })
  it('clears old selections and ignores a late chapter response after switching again', async () => {
    let resolveFirst!: (value: unknown) => void
    await open()
    mocks.chapter.mockImplementation((_sessionId, id) => id === 'chapter-1'
      ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve({ chapter: source }))
    fireEvent.change(screen.getByRole('combobox', { name: '切换原章节' }), { target: { value: 'chapter-1' } })
    expect(screen.queryByLabelText('原文（选中要改写的段落）')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '切换原章节' }), { target: { value: 'chapter-2' } })
    await screen.findByLabelText('原文（选中要改写的段落）')
    resolveFirst({ chapter: { id: 'chapter-1', title: '第一章', content: '迟到的第一章', revision: 'old' } })
    await waitFor(() => expect(screen.getByLabelText('原文（选中要改写的段落）')).toHaveValue(source.content))
    expect(screen.queryByRole('option', { name: '未来章' })).not.toBeInTheDocument()
  })
  it('opens a restore preview without confirming or starting generation', async () => {
    mocks.chapterHistory.mockResolvedValue({ history: [{ id: 'version', chapterTitle: '第二章', kind: 'apply_chapter_edit', createdAt: 1, canRestore: true }], hasMore: false })
    const action = { id: 'restore-preview', kind: 'restore_chapter', status: 'pending' }
    mocks.prepare.mockResolvedValue({ action })
    await open()
    fireEvent.click(screen.getByText('章节修改历史 · 1'))
    fireEvent.click(screen.getByRole('button', { name: '预览恢复' }))
    await waitFor(() => expect(callbacks.onPrepared).toHaveBeenCalledWith(action))
    expect(mocks.prepare).toHaveBeenCalledWith('session', 'restore_chapter', 'version')
    expect(mocks.editChapter).not.toHaveBeenCalled()
  })
})
