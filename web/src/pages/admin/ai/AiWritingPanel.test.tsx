import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getStyleProfile: vi.fn(),
  refreshStyleProfile: vi.fn(),
  getPlotState: vi.fn(),
  getRelationshipProfile: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  aiApi: {
    tasks: vi.fn().mockResolvedValue({ items: [] }),
    generations: vi.fn().mockResolvedValue({ items: [] }),
    writing: {
      getStyleProfile: api.getStyleProfile,
      refreshStyleProfile: api.refreshStyleProfile,
      getPlotState: api.getPlotState,
      getRelationshipProfile: api.getRelationshipProfile,
    },
  },
  chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [] }) },
  novelsApi: { list: vi.fn().mockResolvedValue({ novels: [{ id: 'novel_1', title: '测试小说' }] }) },
}))

vi.mock('@/components/feedback', () => ({
  useToast: () => ({ toast: vi.fn() }),
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))

vi.mock('@/components/admin/CustomSelect', () => ({
  default: (props: { options: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) => (
    <select aria-label="目标小说" value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">请选择小说</option>
      {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

import AiWritingPanel from './AiWritingPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('AiWritingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getPlotState.mockResolvedValue({ state: '', chaptersThrough: 0, chapterCount: 0 })
    api.getRelationshipProfile.mockResolvedValue({ profile: '' })
  })

  it('重新提取完成后不应被在途的旧风格画像读取覆盖', async () => {
    const initialProfile = deferred<{ profile: string }>()
    api.getStyleProfile.mockReturnValue(initialProfile.promise)
    api.refreshStyleProfile.mockResolvedValue({ profile: '最新风格画像' })

    render(<AiWritingPanel />)
    await screen.findByRole('option', { name: '测试小说' })
    fireEvent.change(await screen.findByRole('combobox', { name: '目标小说' }), { target: { value: 'novel_1' } })
    await waitFor(() => expect(api.getStyleProfile).toHaveBeenCalledWith('novel_1'))

    fireEvent.click(screen.getByRole('button', { name: '提取风格画像' }))
    await waitFor(() => expect(api.refreshStyleProfile).toHaveBeenCalledWith('novel_1'))
    await screen.findByText('最新风格画像')

    act(() => initialProfile.resolve({ profile: '' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('最新风格画像')).toBeInTheDocument()
  })
})
