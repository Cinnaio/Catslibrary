import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ReadingDataPanel } from './ReadingDataPanel'
import { getNovelHistory, saveHistory, setStorageUser } from '../lib/storage'
const mocks = vi.hoisted(() => ({ check: vi.fn(), preview: vi.fn(), apply: vi.fn(), operations: vi.fn(), confirm: vi.fn(), safeMode: true }))
vi.mock('../lib/api', () => ({
  getToken: () => sessionStorage.getItem('user_session_token') || '',
  readingDataApi: { check: mocks.check, preview: mocks.preview, apply: mocks.apply, operations: mocks.operations },
}))
vi.mock('../context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ safeMode: mocks.safeMode }) }))
vi.mock('./feedback', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }))
const report = {
  userId: 'a',
  previewToken: 'a'.repeat(64),
  expiresAt: Date.now() + 600000,
  hasMore: false,
  items: [{ kind: 'progress', novelId: 'n', chapterId: 'c', novelTitle: '旧书', chapterTitle: '第一章', action: 'restore', detail: '添加到当前账号' }],
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  mocks.safeMode = true
  sessionStorage.setItem('user_session_token', 'a')
  setStorageUser('a')
  mocks.operations.mockResolvedValue({ operations: [] })
  mocks.preview.mockResolvedValue(report)
  mocks.confirm.mockResolvedValue(true)
  mocks.check.mockResolvedValue({ ...report, items: [{ ...report.items[0], action: 'clear', detail: '清除无效进度' }] })
  mocks.apply.mockResolvedValue({ operationId: 'operation', kind: 'restore', changed: 1, skipped: 0, clearedNovelIds: [], createdAt: Date.now() })
})
it('不自动上传旧数据，预览、归属勾选和账号确认后才恢复，原始键保持不变', async () => {
  const original = JSON.stringify({ n: { novelId: 'n', chapterId: 'c', scrollPercent: 0.5 } })
  localStorage.setItem('novel_reading_history', original)
  render(<ReadingDataPanel userId="a" username="reader-a" />)
  expect(mocks.preview).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '预览可恢复数据' }))
  const button = await screen.findByRole('button', { name: '恢复到当前账号' })
  expect(button).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  await waitFor(() => expect(mocks.apply).toHaveBeenCalledOnce())
  expect(mocks.confirm.mock.calls[0]?.[0]?.message).toContain('@reader-a')
  expect(mocks.apply).toHaveBeenCalledWith(
    'restore',
    expect.objectContaining({ confirmedUserId: 'a', data: expect.objectContaining({ progress: [expect.objectContaining({ novelId: 'n' })] }) }),
    'safe',
  )
  expect(localStorage.getItem('novel_reading_history')).toBe(original)
  await screen.findByText('恢复完成：处理 1 项。')
})
it('取消确认不写入；浏览器数据在确认前变化则要求重新预览', async () => {
  localStorage.setItem('novel_reading_history', JSON.stringify({ n: { chapterId: 'c' } }))
  mocks.confirm.mockResolvedValueOnce(false)
  render(<ReadingDataPanel userId="a" username="reader-a" />)
  fireEvent.click(screen.getByRole('button', { name: '预览可恢复数据' }))
  const button = await screen.findByRole('button', { name: '恢复到当前账号' })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  await waitFor(() => expect(button).not.toBeDisabled())
  expect(mocks.apply).not.toHaveBeenCalled()
  localStorage.setItem('novel_reading_history', '{}')
  fireEvent.click(button)
  await screen.findByText('浏览器旧数据已变化，请重新预览')
  expect(mocks.apply).not.toHaveBeenCalled()
})
it('确认期间换账号不会提交旧请求，旧响应也不能更新新账号界面', async () => {
  let resolve!: (value: boolean) => void
  mocks.confirm.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        resolve = r
      }),
  )
  const rendered = render(<ReadingDataPanel key="a" userId="a" username="reader-a" />)
  fireEvent.click(screen.getByRole('button', { name: '检查当前账号' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认修复 1 项' }))
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
  sessionStorage.setItem('user_session_token', 'b')
  setStorageUser('b')
  rendered.rerender(<ReadingDataPanel key="b" userId="b" username="reader-b" />)
  resolve(true)
  await waitFor(() => expect(screen.getByRole('button', { name: '检查当前账号' })).not.toBeDisabled())
  expect(mocks.apply).not.toHaveBeenCalled()
  expect(screen.queryByText('旧书')).not.toBeInTheDocument()
})
it('服务端修复失败保留本地历史，成功后仅清理已修复进度的账号缓存', async () => {
  saveHistory('n', { chapterId: 'c' })
  saveHistory('keep', { chapterId: 'other' })
  mocks.apply.mockRejectedValueOnce(new Error('预览已过期'))
  render(<ReadingDataPanel userId="a" username="reader-a" />)
  fireEvent.click(screen.getByRole('button', { name: '检查当前账号' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认修复 1 项' }))
  await screen.findByText('预览已过期')
  expect(getNovelHistory('n')?.chapterId).toBe('c')
  mocks.apply.mockResolvedValueOnce({ operationId: 'repair', kind: 'repair', changed: 1, skipped: 0, clearedNovelIds: ['n'], createdAt: Date.now() })
  fireEvent.click(screen.getByRole('button', { name: '检查当前账号' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认修复 1 项' }))
  await screen.findByText('修复完成：处理 1 项。')
  expect(getNovelHistory('n')).toBeNull()
  expect(getNovelHistory('keep')?.chapterId).toBe('other')
})
