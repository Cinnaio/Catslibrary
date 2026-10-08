import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BatchNovelFollowupDialog from './BatchNovelFollowupDialog'
vi.mock('@/lib/api', () => ({ url: (value: string) => value, authHeaders: () => ({}) }))
vi.mock('./CustomSelect', () => ({
  default: ({ options, value, onChange, disabled, ...props }: any) => (
    <select aria-labelledby={props['aria-labelledby']} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))
const novels = [
  { id: 'one', title: '连载作品' },
  { id: 'two', title: '完结作品' },
]
afterEach(() => vi.unstubAllGlobals())
it('提交选定范围、开关及频率，展示部分成功和跳过原因', async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      saved: 1,
      skipped: 1,
      results: [
        { novelId: 'one', title: '连载作品', status: 'saved', reason: '' },
        { novelId: 'two', title: '完结作品', status: 'skipped', reason: '已完结作品不参与自动追更' },
      ],
    }),
  })
  vi.stubGlobal('fetch', fetch)
  render(<BatchNovelFollowupDialog novels={novels} onClose={() => {}} />)
  fireEvent.change(screen.getByRole('combobox', { name: '检查频率' }), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '应用设置' }))
  expect(await screen.findByText('已设置 1 本，跳过 1 本。')).toBeInTheDocument()
  expect(screen.getByText('已完结作品不参与自动追更')).toBeInTheDocument()
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ action: 'followup-batch-save', novelIds: ['one', 'two'], mode: 'enable', intervalHours: 3 })
  expect(screen.getByRole('button', { name: '已应用' })).toBeDisabled()
})
it('暂停隐藏频率并且请求不覆盖原频率', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 2, skipped: 0, results: [] }) })
  vi.stubGlobal('fetch', fetch)
  render(<BatchNovelFollowupDialog novels={novels} onClose={() => {}} />)
  fireEvent.change(screen.getByRole('combobox', { name: '追更操作' }), { target: { value: 'pause' } })
  expect(screen.queryByRole('combobox', { name: '检查频率' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '应用设置' }))
  await screen.findByText('已设置 2 本，跳过 0 本。')
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).not.toHaveProperty('intervalHours')
})
it('失败保留操作和频率，允许重试', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '保存失败，请稍后重试' }) }))
  render(<BatchNovelFollowupDialog novels={novels} onClose={() => {}} />)
  fireEvent.change(screen.getByRole('combobox', { name: '追更操作' }), { target: { value: 'frequency' } })
  fireEvent.change(screen.getByRole('combobox', { name: '检查频率' }), { target: { value: '12' } })
  fireEvent.click(screen.getByRole('button', { name: '应用设置' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
  expect(screen.getByRole('combobox', { name: '检查频率' })).toHaveValue('12')
  expect(screen.getByRole('combobox', { name: '追更操作' })).toHaveValue('frequency')
  await waitFor(() => expect(screen.getByRole('button', { name: '应用设置' })).toBeEnabled())
})
