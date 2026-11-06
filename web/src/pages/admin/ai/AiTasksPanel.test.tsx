import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ tasks: vi.fn(), toast: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/api', () => ({ aiApi: { tasks: mocks.tasks }, newOperationId: () => 'operation' }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: mocks.confirm }) }))
vi.mock('./useAiConfigured', () => ({ useAiConfigured: () => true }))
vi.mock('@/components/shared/SearchSelect', () => ({
  default: ({ value, onChange, options, 'aria-label': label }: {
    value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; 'aria-label': string
  }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}))
import AiTasksPanel from './AiTasksPanel'

function data(title: string, status = 'completed') {
  return { items: [{ id: `task-${title}`, novelTitle: title, novelId: 'book', kind: 'continue', status, current: 1, total: 2, step: '', prompt: '', createdAt: 1 }], total: 1 }
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('切换筛选后旧响应不能覆盖新列表', async () => {
  let finish!: (value: ReturnType<typeof data>) => void
  mocks.tasks.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce(data('新筛选结果'))
  render(<MemoryRouter><AiTasksPanel /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('按 AI 任务状态筛选'), { target: { value: 'completed' } })
  await screen.findByText('新筛选结果')
  await act(async () => finish(data('旧筛选结果')))
  expect(screen.queryByText('旧筛选结果')).not.toBeInTheDocument()
  expect(screen.getByText('新筛选结果')).toBeInTheDocument()
})

it('慢轮询不叠加请求，完成后停止', async () => {
  vi.useFakeTimers()
  let finish!: (value: ReturnType<typeof data>) => void
  mocks.tasks.mockResolvedValueOnce(data('当前任务', 'running'))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { render(<MemoryRouter><AiTasksPanel /></MemoryRouter>) })
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000) })
  expect(mocks.tasks).toHaveBeenCalledTimes(2)
  await act(async () => { finish(data('当前任务')); await vi.advanceTimersByTimeAsync(12_000) })
  expect(mocks.tasks).toHaveBeenCalledTimes(2)
})
