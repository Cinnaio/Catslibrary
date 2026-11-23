import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { KeepsakeContext, KeepsakePage, ReadingKeepsake } from '@shared/reading-keepsakes'
const mocks = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn(), confirm: vi.fn(), token: 'reader-a' }))
vi.mock('@/lib/api', () => ({ getToken: () => mocks.token, url: (path: string) => `/api${path}` }))
vi.mock('@/lib/storage', () => ({ getStorageScope: () => mocks.token }))
vi.mock('@/lib/reading-keepsakes', async importOriginal => ({ ...await importOriginal<object>(), keepsakesApi: mocks }))
vi.mock('../feedback', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }))
import ReadingKeepsakes from './ReadingKeepsakes'
import { keepsakeDate, keepsakeText } from '../../lib/reading-keepsakes'

const context: KeepsakeContext = { novel: { title: '雨天的约定', author: '一位作者', coverUrl: '' }, latestId: null, startedAt: null, candidatesLimited: false,
  candidates: Array.from({ length: 4 }, (_, i) => ({ id: `moment-${i}`, chapterTitle: `章节${i}`, selectedText: `原句${i}`, thoughtText: `我的感受${i}` })) }
const item: ReadingKeepsake = { id: 'saved-card-1', novelId: 'novel-a', ...context.novel, startedAt: null,
  savedAt: Date.UTC(2026, 10, 22, 17), closing: '故事留在这里。', moments: [] }
const setup = () => render(<ReadingKeepsakes novelId="novel-a" mode="safe" onClose={vi.fn()} />)
beforeEach(() => {
  vi.resetAllMocks(); mocks.token = 'reader-a'
  mocks.context.mockResolvedValue(context); mocks.list.mockResolvedValue({ items: [], nextCursor: null })
  mocks.save.mockResolvedValue({ item }); mocks.confirm.mockResolvedValue(true); mocks.remove.mockResolvedValue({ ok: true })
})

it('主动写下寄语才允许保存，预览不会自动创建留念页', async () => {
  setup()
  const editor = await screen.findByRole('textbox', { name: /这本书留给我的是/ })
  expect(mocks.save).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '保存这页余温' })).toBeDisabled()
  fireEvent.change(editor, { target: { value: item.closing } })
  fireEvent.click(screen.getByRole('button', { name: '保存这页余温' }))
  await screen.findByLabelText('已保存的藏书票')
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('novel-a', 'safe', expect.objectContaining({ closing: item.closing, previousId: null, momentIds: [] }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('候选最多选择三则，取消后可以另选；无记录不显示虚构的开始日期', async () => {
  setup(); const boxes = await screen.findAllByRole('checkbox')
  boxes.slice(0, 3).forEach(box => fireEvent.click(box))
  expect(boxes[3]).toBeDisabled()
  fireEvent.click(boxes[1]!)
  expect(boxes[3]).toBeEnabled()
  fireEvent.click(boxes[3]!)
  expect(within(screen.getByLabelText('藏书票预览')).queryByText(/阅读记录起于/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存这页余温' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('novel-a', 'safe', expect.objectContaining({ momentIds: ['moment-0', 'moment-2', 'moment-3'] })))
})

it('网络异常后保留同一请求和草稿，重试不生成第二个标识', async () => {
  mocks.save.mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ item })
  setup(); fireEvent.change(await screen.findByRole('textbox'), { target: { value: item.closing } })
  fireEvent.click(screen.getByRole('button', { name: '保存这页余温' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox')).toHaveValue(item.closing)
  expect(screen.getByRole('textbox')).toBeDisabled()
  const first = mocks.save.mock.calls[0]![2]
  fireEvent.click(screen.getByRole('button', { name: '重试保存同一页' }))
  await screen.findByLabelText('已保存的藏书票')
  expect(mocks.save.mock.calls[1]![2]).toEqual(first)
})

it('账号切换后旧请求的私人内容不能进入面板', async () => {
  let resolve!: (value: KeepsakePage) => void
  mocks.list.mockReturnValue(new Promise(r => { resolve = r }))
  setup(); mocks.token = 'reader-b'
  await act(async () => resolve({ items: [{ ...item, closing: '上个账号的秘密' }], nextCursor: null }))
  expect(screen.queryByText('上个账号的秘密')).toBeNull()
  expect(screen.queryByLabelText('已保存的藏书票')).toBeNull()
})

it('关闭后的旧回执不会写入新面板', async () => {
  let resolve!: (value: { item: ReadingKeepsake }) => void
  mocks.save.mockReturnValue(new Promise(r => { resolve = r }))
  const first = setup()
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: '第一次打开的寄语' } })
  fireEvent.click(screen.getByRole('button', { name: '保存这页余温' }))
  first.unmount(); setup()
  await screen.findByRole('textbox')
  await act(async () => resolve({ item }))
  expect(screen.queryByLabelText('已保存的藏书票')).toBeNull()
  expect(screen.getByRole('textbox')).toHaveValue('')
})

it('已有留念页先重看；再留一页刷新阅读起点和上一页标识', async () => {
  mocks.list.mockResolvedValue({ items: [item], nextCursor: null })
  mocks.context.mockResolvedValue({ ...context, latestId: item.id })
  setup(); await screen.findByLabelText('已保存的藏书票')
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '再留一页' }))
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: '重读有新的感受。' } })
  fireEvent.click(screen.getByRole('button', { name: '保存这页余温' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('novel-a', 'safe', expect.objectContaining({ previousId: item.id, closing: '重读有新的感受。' })))
})

it('重新失去书籍权限时清除已加载的私人快照', async () => {
  mocks.list.mockResolvedValueOnce({ items: [item], nextCursor: 'cursor' }).mockRejectedValueOnce(Object.assign(new Error('不可访问'), { status: 403 }))
  setup(); await screen.findByLabelText('已保存的藏书票')
  fireEvent.click(screen.getByRole('button', { name: '查看更早的藏书票' }))
  await screen.findByRole('alert')
  expect(screen.queryByLabelText('已保存的藏书票')).toBeNull()
  expect(screen.queryByRole('button', { name: '导出文字' })).toBeNull()
})

it('删除前确认，取消不调用接口；删除最后一页后刷新', async () => {
  mocks.list.mockResolvedValueOnce({ items: [item], nextCursor: null }).mockResolvedValue({ items: [], nextCursor: null })
  mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  setup(); await screen.findByLabelText('已保存的藏书票')
  fireEvent.click(screen.getByRole('button', { name: '删除当前藏书票' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
  expect(mocks.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '删除当前藏书票' }))
  await screen.findByRole('textbox')
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('novel-a', 'safe', item.id)
})

it('导出采用北京时间并保留多行想法，不把原句当作 AI 内容', () => {
  expect(keepsakeDate(item.savedAt)).toBe('2026年11月23日')
  const text = keepsakeText({ ...item, moments: [context.candidates[0]!] })
  expect(text).toContain('“原句0”\n—— 章节0\n我的感受0')
  expect(text).toContain('这本书留给我的是……\n故事留在这里。')
  expect(text).not.toContain('阅读记录起于')
})
