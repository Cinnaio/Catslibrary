import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  saveProfileOverride: vi.fn(),
  deleteProfileOverride: vi.fn(),
  getStyleProfile: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  aiApi: { writing: api },
  newOperationId: (prefix: string) => `${prefix}-test-op`,
}))

const toastSpy = vi.hoisted(() => vi.fn())
const confirmSpy = vi.hoisted(() => vi.fn())
vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: toastSpy }),
  useConfirm: () => ({ confirm: confirmSpy }),
}))

import ProfileOverrideEditor from './ProfileOverrideEditor'
import type { AiEffectiveProfile } from '@/lib/api'

function effective(overrides: Partial<AiEffectiveProfile> = {}): AiEffectiveProfile {
  return {
    eligibility: 'usable',
    isOlderThanAnchor: false,
    effectiveContent: '自动提取的画像内容',
    effectiveOrigin: 'automatic',
    baseProfileRevision: 'base_rev_1',
    ...overrides,
  }
}

function renderEditor(props: Partial<Parameters<typeof ProfileOverrideEditor>[0]> = {}) {
  const onChanged = vi.fn()
  render(
    <ProfileOverrideEditor
      novelId="novel_1"
      kind="style"
      effective={effective()}
      onChanged={onChanged}
      {...props}
    />,
  )
  return { onChanged }
}

describe('ProfileOverrideEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.saveProfileOverride.mockResolvedValue({ ok: true, effectiveOrigin: 'manual' })
    api.deleteProfileOverride.mockResolvedValue({ ok: true, effectiveOrigin: 'automatic' })
    confirmSpy.mockResolvedValue(true)
  })

  it('未校正时说明正在使用自动画像', () => {
    renderEditor()
    expect(screen.getByText('未校正 · 使用自动画像')).toBeInTheDocument()
    expect(screen.getByText('续写使用自动提取的画像；如需局部修订可另存人工校正。')).toBeInTheDocument()
    // 没有人工层时不该出现「删除校正」
    expect(screen.queryByRole('button', { name: '删除校正' })).not.toBeInTheDocument()
  })

  it('打开编辑器时以当前生效内容预填', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '人工校正' }))
    const textarea = screen.getByLabelText(/校正内容/) as HTMLTextAreaElement
    expect(textarea.value).toBe('自动提取的画像内容')
  })

  it('保存时回传基准版本号与当前修订号', async () => {
    const { onChanged } = renderEditor({
      effective: effective({
        manualOverride: { content: '旧校正', revision: 3, baseProfileRevision: 'base_rev_1', updatedBy: 'u1', updatedAt: 1 },
        effectiveOrigin: 'manual',
        effectiveContent: '旧校正',
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: '编辑校正' }))
    fireEvent.change(screen.getByLabelText(/校正内容/), { target: { value: '新的校正内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存校正' }))

    await waitFor(() => expect(api.saveProfileOverride).toHaveBeenCalled())
    expect(api.saveProfileOverride.mock.calls[0]![0]).toBe('novel_1')
    expect(api.saveProfileOverride.mock.calls[0]![1]).toBe('style')
    expect(api.saveProfileOverride.mock.calls[0]![2]).toMatchObject({
      content: '新的校正内容',
      // 已有校正时必须带当前修订号，否则后端的乐观并发会 409
      expectedRevision: 3,
      baseProfileRevision: 'base_rev_1',
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('空内容不发起保存', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '人工校正' }))
    fireEvent.change(screen.getByLabelText(/校正内容/), { target: { value: '   ' } })
    // 空白内容时保存按钮应禁用
    expect(screen.getByRole('button', { name: '保存校正' })).toBeDisabled()
    expect(api.saveProfileOverride).not.toHaveBeenCalled()
  })

  it('409 时提示重新读取并触发刷新', async () => {
    api.saveProfileOverride.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    const { onChanged } = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: '人工校正' }))
    fireEvent.change(screen.getByLabelText(/校正内容/), { target: { value: '会冲突的内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存校正' }))

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('重新保存'), 'error'))
    // 冲突后仍要刷新，否则界面停在旧版本号上，重试必然再冲突
    expect(onChanged).toHaveBeenCalled()
  })

  it('人工层未生效时明确区分「已保存」与「正在生效」', () => {
    renderEditor({
      effective: effective({
        manualOverride: { content: '校正内容', revision: 2, baseProfileRevision: 'old', updatedBy: 'u1', updatedAt: 1 },
        effectiveOrigin: 'automatic',
        exclusionReason: 'base_changed',
      }),
    })
    expect(screen.getByText('校正已保存但未生效')).toBeInTheDocument()
    expect(screen.getByText(/自动画像在保存后已重新提取/)).toBeInTheDocument()
  })

  it('自动画像不可用时禁用保存并说明原因', () => {
    renderEditor({
      effective: effective({ eligibility: 'missing', effectiveOrigin: 'none', effectiveContent: '' }),
    })
    expect(screen.getByText(/人工校正无处挂靠/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '人工校正' })).toBeDisabled()
  })

  it('删除校正需要确认，确认后回到自动层', async () => {
    const { onChanged } = renderEditor({
      effective: effective({
        manualOverride: { content: '校正内容', revision: 1, baseProfileRevision: 'base_rev_1', updatedBy: 'u1', updatedAt: 1 },
        effectiveOrigin: 'manual',
        effectiveContent: '校正内容',
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: '删除校正' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    await waitFor(() => expect(api.deleteProfileOverride).toHaveBeenCalled())
    expect(api.deleteProfileOverride.mock.calls[0]![2]).toMatchObject({ expectedRevision: 1 })
    expect(onChanged).toHaveBeenCalled()
  })

  it('确认框取消时不删除', async () => {
    confirmSpy.mockResolvedValue(false)
    renderEditor({
      effective: effective({
        manualOverride: { content: '校正内容', revision: 1, baseProfileRevision: 'base_rev_1', updatedBy: 'u1', updatedAt: 1 },
        effectiveOrigin: 'manual',
        effectiveContent: '校正内容',
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: '删除校正' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(api.deleteProfileOverride).not.toHaveBeenCalled()
  })
})
