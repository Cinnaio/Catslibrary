import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import NovelFollowupDialog from './NovelFollowupDialog'
vi.mock('./NovelRelatedSources', () => ({ default: () => <div>附加文件更新 · 章节名与顺序</div> }))
vi.mock('@/lib/api', () => ({ authFetch: (value: string, init: RequestInit) => fetch(value, init) }))
vi.mock("@/components/shared/SearchSelect", () => ({
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
  fireEvent.click(screen.getByRole('button', { name: '保存网页追更设置' }))
  await screen.findByText('追更设置已保存')
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ novelId: 'n', action: 'followup-save', enabled: true, intervalHours: 3 })
})
it('未配置爬虫时不能开启或手动更新', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...state, hasConfig: false }) }))
  render(<NovelFollowupDialog novel={{ id: 'n', title: '测试书' }} onClose={() => {}} />)
  await screen.findByRole('button', { name: '绑定网页来源' })
  expect(screen.queryByRole('checkbox', { name: '自动追更' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: '检查频率' })).not.toBeInTheDocument()
  expect(screen.queryByText(/请先在抓取中心/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '检查网页更新' })).not.toBeInTheDocument()
})
it('完结作品默认关闭但允许手动开启并保存', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...state, ongoing: false }) })
  vi.stubGlobal('fetch', fetch)
  render(<NovelFollowupDialog novel={{ id: 'done', title: '完结作品' }} onClose={() => {}} />)
  const checkbox = await screen.findByRole('checkbox', { name: '自动追更' })
  expect(checkbox).toBeEnabled()
  expect(checkbox).not.toBeChecked()
  expect(screen.getByText('已完结作品默认不追更；如需继续检查，可手动开启。')).toBeInTheDocument()
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '保存网页追更设置' }))
  await screen.findByText('追更设置已保存')
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ novelId: 'done', enabled: true })
})
it('手动更新出错时显示服务端原因并允许重试', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => state })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: '源站不可达' }) })
  vi.stubGlobal('fetch', fetch)
  render(<NovelFollowupDialog novel={{ id: 'n', title: '测试书' }} onClose={() => {}} />)
  await screen.findByRole('checkbox', { name: '自动追更' })
  fireEvent.click(screen.getByRole('button', { name: '检查网页更新' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('源站不可达')
  await waitFor(() => expect(screen.getByRole('button', { name: '检查网页更新' })).toBeEnabled())
})

it('追更窗口显示待入库中的受保护数量，并说明访问权限', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
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

it('TXT 书可绑定网页来源，但来源保存不会隐式开启追更', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...state, hasConfig: false, chapterCount: 52, importSourceLabel: '测试书.txt' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...state, enabled: false, sourceUrl: 'https://www.po18.tw/books/123' }) })
  vi.stubGlobal('fetch', fetch)
  render(<NovelFollowupDialog novel={{ id: 'txt', title: '测试书' }} onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: '绑定网页来源' }))
  expect(screen.getByText(/本地已入库 52 章/)).toHaveTextContent('测试书.txt')
  fireEvent.change(screen.getByLabelText('作品目录链接'), { target: { value: 'https://www.po18.tw/books/123' } })
  fireEvent.click(screen.getByRole('button', { name: '保存网页来源' }))
  expect(await screen.findByRole('checkbox', { name: '自动追更' })).not.toBeChecked()
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ novelId: 'txt', action: 'followup-source-save', sourceUrl: 'https://www.po18.tw/books/123' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('网页配置失效后仍可明确暂停，保留已有频率', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...state, enabled: true, hasConfig: false, intervalHours: 12 }) })
    .mockResolvedValue({ ok: true, json: async () => ({ ...state, enabled: false, hasConfig: false, intervalHours: 12 }) })
  vi.stubGlobal('fetch', fetch)
  render(<NovelFollowupDialog novel={{ id: 'stale', title: '失效来源' }} onClose={() => {}} />)
  const checkbox = await screen.findByRole('checkbox', { name: '自动追更' })
  expect(checkbox).toBeEnabled()
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: '保存网页追更设置' }))
  await screen.findByText('追更设置已保存')
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ novelId: 'stale', action: 'followup-save', enabled: false, intervalHours: 12 })
})
