import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { StoryEchoResponse } from '@shared/story-echoes'
const mocks = vi.hoisted(() => ({ find: vi.fn(), card: vi.fn(), status: vi.fn(), token: 'reader-a' }))
vi.mock('@/lib/api', () => ({ getToken: () => mocks.token }))
vi.mock('@/lib/storage', () => ({ getStorageScope: () => mocks.token }))
vi.mock('@/lib/story-echoes', () => ({ findStoryEchoes: mocks.find, findCharacterCard: mocks.card }))
vi.mock('@/hooks/useAiStatus', () => ({ loadAiStatus: mocks.status }))
import StoryEchoes from './StoryEchoes'
const input = { chapterId: 'c2', paragraphIndex: 3, paragraphHash: 'hash2', selectedText: '他再次拿起那枚银铃。' }
const response = (overrides: Partial<StoryEchoResponse> = {}): StoryEchoResponse => ({
  anchor: { ...input, chapterTitle: '第二章', chapterOrder: 2, quote: input.selectedText },
  items: [{ source: { chapterId: 'c1', chapterTitle: '初见', chapterOrder: 1, paragraphIndex: 0, paragraphHash: 'hash1', quote: '她把银铃留在窗边。' }, explanation: '银铃可能呼应初见时的约定。' }],
  cached: false, generated: true, searchedChapters: 1, candidateCount: 2, limited: false, omitted: 0, model: 'test', ...overrides,
})
beforeEach(() => { vi.resetAllMocks(); mocks.token = 'reader-a'; mocks.status.mockResolvedValue({ quota: { limit: 30, used: 0 } }); mocks.find.mockResolvedValue(response()) })
function setup(purpose: 'echo' | 'character' = 'echo') {
  const onClose = vi.fn(), onSource = vi.fn()
  return { ...render(<StoryEchoes purpose={purpose} input={purpose === "character" ? { ...input, selectedText: "林舟" } : input} chapterTitle="第二章" onClose={onClose} onSource={onSource} />), onClose, onSource }
}
it('先展示选句，明确点击才生成；原文按钮传递已核验的段落锚点', async () => {
  const { onSource } = setup()
  expect(screen.getByText(input.selectedText)).toBeInTheDocument()
  expect(mocks.find).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' }))
  await screen.findByText('她把银铃留在窗边。')
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(input)
  fireEvent.click(screen.getByRole('button', { name: /回到原文/ }))
  expect(onSource).toHaveBeenCalledWith(response().items[0]!.source)
})
it('零额度仍允许复用缓存，不显示需要额外付费的假象', async () => {
  mocks.status.mockResolvedValue({ quota: { limit: 1, used: 1 } }); mocks.find.mockResolvedValue(response({ cached: true }))
  setup()
  await screen.findByText('额度用完后仍可查看已缓存的结果。')
  fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' }))
  await screen.findByText('本次复用了近期结果，未使用新的 AI 额度。')
})
it('源段落变化后要求重新选择，不能重复提交旧锚点', async () => {
  mocks.find.mockRejectedValue(Object.assign(new Error('选段已变化'), { status: 409 }))
  setup(); fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '查找前文的回声' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('重新选择正文')
})
it('账号切换后丢弃旧账号延迟返回的引用', async () => {
  let resolve!: (value: StoryEchoResponse) => void
  mocks.find.mockReturnValue(new Promise(r => { resolve = r }))
  setup(); fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' }))
  mocks.token = 'reader-b'
  await act(async () => resolve(response()))
  expect(screen.queryByText('她把银铃留在窗边。')).toBeNull()
})
it('关闭后允许请求结束但不会把旧结果带入下一次打开的选段', async () => {
  let resolve!: (value: StoryEchoResponse) => void
  mocks.find.mockReturnValueOnce(new Promise(r => { resolve = r }))
  const first = setup(); fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' })); first.unmount()
  setup()
  await act(async () => resolve(response()))
  expect(screen.queryByText('她把银铃留在窗边。')).toBeNull()
  expect(screen.getByRole('button', { name: '查找前文的回声' })).toBeEnabled()
})
it('无候选时准确说明未调用 AI，并且不宣称前文没有呼应', async () => {
  mocks.find.mockResolvedValue(response({ items: [], generated: false, candidateCount: 0 }))
  setup(); fireEvent.click(screen.getByRole('button', { name: '查找前文的回声' }))
  await waitFor(() => expect(screen.getByText('未找到可核对的候选片段，本次未调用 AI。')).toBeInTheDocument())
  expect(screen.getByText(/没有找到，并不代表前文没有呼应/)).toBeInTheDocument()
})


it('人物小卡由读者点击生成，并展示分类、歧义和原文回读', async () => {
  const source = { ...response().items[0]!.source, quote: '林舟和许宁一同来到渡口。' }
  mocks.card.mockResolvedValue({ ...response(), items: [{ source, explanation: '这处同名是否指当前人物尚待确认。', kind: 'relationship', certainty: 'uncertain' }] })
  const { onSource } = setup('character')
  expect(screen.getByText('林舟')).toBeInTheDocument(); expect(mocks.card).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '查看人物线索' }))
  await screen.findByText('人物联系'); expect(screen.getByText('身份或关系待确认')).toBeInTheDocument()
  expect(mocks.card).toHaveBeenCalledExactlyOnceWith({ ...input, selectedText: '林舟' }); expect(mocks.find).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /回到原文/ })); expect(onSource).toHaveBeenCalledWith(source)
})

it('人物小卡空结果承认名字和别名检索的范围，不断言人物未出现', async () => {
  mocks.card.mockResolvedValue(response({ items: [], generated: false, candidateCount: 0 }))
  setup('character'); fireEvent.click(screen.getByRole('button', { name: '查看人物线索' }))
  await screen.findByText('这次还没有找到可核对的人物线索。')
  expect(screen.getByText(/没有找到不代表此前没有出现/)).toBeInTheDocument()
  expect(screen.getByText('未找到可核对的候选片段，本次未调用 AI。')).toBeInTheDocument()
})

it('人物小卡账号切换时丢弃返回的私人结果', async () => {
  let resolve!: (value: StoryEchoResponse) => void
  mocks.card.mockReturnValue(new Promise(r => { resolve = r }))
  setup('character'); fireEvent.click(screen.getByRole('button', { name: '查看人物线索' }))
  mocks.token = 'reader-b'
  await act(async () => resolve(response()))
  expect(screen.queryByText('她把银铃留在窗边。')).toBeNull()
})

it('人物小卡权限丢失时终止同次重试，要求重新选择', async () => {
  mocks.card.mockRejectedValue(Object.assign(new Error('无权访问作品'), { status: 403 }))
  setup('character'); fireEvent.click(screen.getByRole('button', { name: '查看人物线索' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '查看人物线索' })).toBeDisabled()
})
