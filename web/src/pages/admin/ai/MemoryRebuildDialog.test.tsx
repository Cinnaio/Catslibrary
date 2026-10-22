import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import MemoryRebuildDialog from './MemoryRebuildDialog'
const api = vi.hoisted(() => ({ previewMemoryRebuild: vi.fn(), rebuildMemory: vi.fn(), memoryHistory: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { writing: api }, newOperationId: () => 'same-operation' }))
const plan = {
  revision: 'version-1',
  items: [
    {
      kind: 'relationship',
      selectedStart: 1,
      selectedEnd: 6,
      actualStart: 1,
      targetOrdinal: 6,
      previousThrough: 6,
      seedSnapshotId: null,
      hasManualOverride: true,
    },
  ],
}
// Native selects expose the dialog behavior without depending on portal pointer geometry.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode
    value: string
    onValueChange: (v: string) => void
    disabled?: boolean
  }) => (
    <select aria-label="选择范围参数" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}))
const changed = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  api.previewMemoryRebuild.mockResolvedValue(plan)
  api.rebuildMemory.mockResolvedValue({ ok: true })
  api.memoryHistory.mockResolvedValue({ items: [] })
})
function open() {
  render(<MemoryRebuildDialog novelId="book" kind="relationship" chapters={[{ value: 'c1', label: '第一章' }]} disabled={false} onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: '重新分析关系画像' }))
}
it('requires preview, discloses actual rebuild and manual-review effects, then submits the preview revision', async () => {
  open()
  expect(screen.queryByRole('button', { name: '确认并开始重建' })).not.toBeInTheDocument()
  fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: '预览实际重建范围' }))
  expect(await screen.findByText(/实际重建第 1–6 章/)).toBeInTheDocument()
  expect(screen.getByText(/没有可复用的前置快照/)).toBeInTheDocument()
  expect(screen.getByText(/人工校正保留/)).toBeInTheDocument()
  expect(api.rebuildMemory).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认并开始重建' }))
  await waitFor(() =>
    expect(api.rebuildMemory).toHaveBeenCalledWith(
      'book',
      expect.objectContaining({ kinds: ['relationship'], range: 'all', sampleChapters: 3 }),
      'version-1',
      'same-operation',
    ),
  )
  expect(changed).toHaveBeenCalledOnce()
})
it('changing settings invalidates the old preview and a failed submit can replay the same operation', async () => {
  open()
  fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: '预览实际重建范围' }))
  await screen.findByRole('button', { name: '确认并开始重建' })
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
  expect(screen.queryByRole('button', { name: '确认并开始重建' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '预览实际重建范围' }))
  api.rebuildMemory.mockRejectedValueOnce(new Error('网络中断'))
  fireEvent.click(await screen.findByRole('button', { name: '确认并开始重建' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('网络中断')
  fireEvent.click(screen.getByRole('button', { name: '确认并开始重建' }))
  await waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(api.rebuildMemory.mock.calls[0]).toEqual(api.rebuildMemory.mock.calls[1])
})
it('never silently accepts an invalid batch size', () => {
  open()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '预览实际重建范围' }))
  expect(screen.getByRole('alert')).toHaveTextContent('1–30')
  expect(api.previewMemoryRebuild).not.toHaveBeenCalled()
})
