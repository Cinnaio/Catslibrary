import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import NovelFollowupDialog from './NovelFollowupDialog'
vi.mock('@/lib/api', () => ({ url: (value: string) => value, authHeaders: () => ({}) }))
vi.mock('./CustomSelect', () => ({
  default: ({ options, value, onChange, ...props }: any) => (
    <select aria-labelledby={props['aria-labelledby']} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))
const state = { enabled: false, intervalHours: 6, nextCheckAt: 0, checkedAt: 0, result: 'idle', message: '', addedCount: 0, hasConfig: true, ongoing: true }
afterEach(() => vi.unstubAllGlobals())
it('保存自动追更开关及频率，并展示保存结果', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => state })
  vi.stubGlobal('fetch', fetch)
  render(<NovelFollowupDialog novel={{ id: 'n', title: '测试书' }} onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '自动追更' }))
  fireEvent.change(screen.getByRole('combobox', { name: '检查频率' }), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await screen.findByText('追更设置已保存')
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ novelId: 'n', action: 'followup-save', enabled: true, intervalHours: 3 })
})
it('未配置爬虫时不能开启或手动更新', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...state, hasConfig: false }) }))
  render(<NovelFollowupDialog novel={{ id: 'n', title: '测试书' }} onClose={() => {}} />)
  expect(await screen.findByRole('checkbox', { name: '自动追更' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled()
})
it('手动更新出错时显示服务端原因并允许重试', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => state })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: '源站不可达' }) })
  vi.stubGlobal('fetch', fetch)
  render(<NovelFollowupDialog novel={{ id: 'n', title: '测试书' }} onClose={() => {}} />)
  await screen.findByRole('checkbox', { name: '自动追更' })
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('源站不可达')
  await waitFor(() => expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled())
})

it('追更窗口显示待入库中的受保护数量，并说明访问权限', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ...state, pendingChapterCount: 4, pendingProtectedChapterCount: 2, pendingPublicChapterCount: 2, pendingUnknownChapterCount: 0 }),
      }),
  )
  render(<NovelFollowupDialog novel={{ id: 'n', title: '测试书' }} onClose={() => {}} />)
  expect(await screen.findByText('待入库 4 章')).toBeInTheDocument()
  expect(screen.getByText('目录可抓取 2 章')).toBeInTheDocument()
  expect(screen.getByText('受保护 2 章')).toBeInTheDocument()
  expect(screen.getByText(/受保护不代表无法抓取/)).toBeInTheDocument()
})
