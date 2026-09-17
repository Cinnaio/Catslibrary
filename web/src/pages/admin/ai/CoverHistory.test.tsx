import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  coverHistory: vi.fn(),
  coverHistoryImage: vi.fn(),
  restoreCoverHistory: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  aiApi: {
    coverHistory: api.coverHistory,
    coverHistoryImage: api.coverHistoryImage,
    restoreCoverHistory: api.restoreCoverHistory,
  },
}))

const toastSpy = vi.hoisted(() => vi.fn())
const confirmSpy = vi.hoisted(() => vi.fn())
vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: toastSpy }),
  useConfirm: () => ({ confirm: confirmSpy }),
}))

import CoverHistory from './CoverHistory'

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hist_1',
    novelId: 'novel_1',
    contentType: 'image/png',
    source: 'upload',
    prompt: '',
    imageHash: 'hash_1',
    createdAt: 1_700_000_000_000,
    reason: 'adopt',
    actorId: 'user_1',
    ...overrides,
  }
}

function renderHistory(props: Partial<Parameters<typeof CoverHistory>[0]> = {}) {
  const onRestored = vi.fn()
  const onCurrentVersion = vi.fn()
  const view = render(
    <CoverHistory
      novelId="novel_1"
      coverVersion={0}
      onRestored={onRestored}
      onCurrentVersion={onCurrentVersion}
      {...props}
    />,
  )
  return { onRestored, onCurrentVersion, unmount: view.unmount }
}

describe('CoverHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom 未实现 object URL
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    URL.revokeObjectURL = vi.fn()
    api.coverHistory.mockResolvedValue({
      items: [item()],
      total: 1,
      current: { version: 'ver_1', source: 'ai', prompt: '', updatedAt: 1, hasImage: true },
    })
    api.coverHistoryImage.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    api.restoreCoverHistory.mockResolvedValue({ ok: true, current: { version: 'ver_2' } })
    confirmSpy.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('默认折叠，但仍把当前封面版本号交给父级用于并发校验', async () => {
    const { onCurrentVersion } = renderHistory()
    // 折叠态不该去拉图片
    expect(screen.queryByRole('button', { name: /封面历史/ })).toBeInTheDocument()
    await waitFor(() => expect(onCurrentVersion).toHaveBeenCalledWith('ver_1'))
    expect(api.coverHistoryImage).not.toHaveBeenCalled()
    expect(screen.queryByText('本地上传')).not.toBeInTheDocument()
  })

  it('展开后才按需拉取快照图片，并在卸载时释放 object URL', async () => {
    const { unmount } = renderHistory()
    await waitFor(() => expect(api.coverHistory).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /封面历史/ }))
    await waitFor(() => expect(api.coverHistoryImage).toHaveBeenCalledWith('novel_1', 'hist_1'))

    // 快照元数据要能读懂：来源 + 归档原因 + 时间
    expect(await screen.findByText('本地上传')).toBeInTheDocument()
    expect(screen.getByText('采纳候选时归档')).toBeInTheDocument()

    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('恢复时带上当前封面版本号，成功后通知父级刷新', async () => {
    const { onRestored } = renderHistory()
    await waitFor(() => expect(api.coverHistory).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /封面历史/ }))
    await screen.findByText('本地上传')

    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))

    await waitFor(() => expect(api.restoreCoverHistory).toHaveBeenCalledWith('novel_1', 'hist_1', 'ver_1'))
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
    expect(toastSpy).toHaveBeenCalledWith('已恢复为当前封面', 'success')
  })

  it('用户取消确认时不发请求', async () => {
    confirmSpy.mockResolvedValue(false)
    const { onRestored } = renderHistory()
    await waitFor(() => expect(api.coverHistory).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /封面历史/ }))
    await screen.findByText('本地上传')

    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(api.restoreCoverHistory).not.toHaveBeenCalled()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('版本冲突（409）时提示并刷新列表，不谎报成功', async () => {
    api.restoreCoverHistory.mockRejectedValue(
      Object.assign(new Error('当前封面已变化，请重新读取后再操作'), { status: 409 }),
    )
    const { onRestored } = renderHistory()
    await waitFor(() => expect(api.coverHistory).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /封面历史/ }))
    await screen.findByText('本地上传')

    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(
      '当前封面已被其他操作改变，已为你刷新列表，请确认后重试',
      'error',
    ))
    // 冲突时也要重取，否则界面还停在旧版本号上，重试必然再冲突
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
  })

  it('没有快照时给出说明而不是空白', async () => {
    api.coverHistory.mockResolvedValue({
      items: [],
      total: 0,
      current: { version: 'ver_1', source: 'default', prompt: '', updatedAt: 1, hasImage: false },
    })
    renderHistory()
    await waitFor(() => expect(api.coverHistory).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /封面历史/ }))
    expect(await screen.findByText(/暂无历史快照/)).toBeInTheDocument()
  })
})
