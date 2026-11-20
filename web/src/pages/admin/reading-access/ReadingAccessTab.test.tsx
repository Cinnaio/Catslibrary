import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReadingAccessSettings, ReadingAccessSummary } from '@shared/reading-access'
import ReadingAccessTab from './ReadingAccessTab'

const mock = vi.hoisted(() => ({
  role: 'admin',
  summary: vi.fn(),
  settings: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: { role: mock.role } }) }))
vi.mock('@/lib/api', () => ({ adminApi: { readingAccess: mock } }))

const limits = {
  guest: [{ minutes: 10, chapters: 60, novels: 6 }],
  account: [{ minutes: 10, chapters: 180, novels: 10 }],
  ip: [{ minutes: 10, chapters: 720, novels: 40 }],
} satisfies ReadingAccessSummary['limits']
const summary: ReadingAccessSummary = {
  mode: 'observe', minuteLimits: { guest: 240, account: 120, ip: 240 }, limits,
  hours: 24, generatedAt: Date.UTC(2026, 10, 20, 5), countsAreCapped: true, byHour: [], signals: [],
}
const settings: ReadingAccessSettings = {
  ...summary, revision: 'test-revision', managedByEnv: ['account:1'], overrides: { mode: null, quotas: { 'guest:1': 240 } },
}

beforeEach(() => {
  mock.role = 'admin'
  vi.resetAllMocks()
  mock.summary.mockResolvedValue(summary)
  mock.settings.mockResolvedValue(settings)
  mock.save.mockResolvedValue(settings)
})

function renderTab() {
  render(<MemoryRouter initialEntries={['/admin/security?view=reading-access']}><ReadingAccessTab /></MemoryRouter>)
}

it('管理员可以读取阈值和空统计，配置入口仅对超级管理员开放', async () => {
  renderTab()
  expect(screen.getByText('监测正文访问与限流情况，查看异常窗口和生效配额。')).toBeVisible()
  expect(await screen.findByText('所选时段暂无游客正文请求记录。')).toBeVisible()
  expect(screen.getByRole('region', { name: '当前生效阈值' })).toHaveTextContent('240 次')
  expect(screen.queryByRole('button', { name: '防护配置' })).toBeNull()
  expect(mock.settings).not.toHaveBeenCalled()
})

it('超级管理员能清空覆盖、保存额度并刷新概览，环境变量字段保持只读', async () => {
  mock.role = 'super_admin'
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: '防护配置' }))
  const guest = await screen.findByRole('spinbutton', { name: '游客 每分钟' })
  expect(screen.getAllByRole('spinbutton')).toHaveLength(4)
  fireEvent.change(guest, { target: { value: '' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: '游客 10 分钟' }), { target: { value: '72' } })
  fireEvent.mouseDown(screen.getByRole('tab', { name: '登录账号' }), { button: 0 })
  expect(screen.getByRole('spinbutton', { name: '登录账号 每分钟' })).toBeDisabled()
  expect(screen.queryByRole('spinbutton', { name: '游客 10 分钟' })).toBeNull()
  fireEvent.mouseDown(screen.getByRole('tab', { name: '游客' }), { button: 0 })
  expect(screen.getByRole('spinbutton', { name: '游客 10 分钟' })).toHaveValue(72)
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  expect(mock.save).toHaveBeenCalledWith({ revision: 'test-revision', overrides: { mode: null, quotas: { 'guest:10': 72 } } })
  await waitFor(() => expect(mock.summary).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('防护配置已保存。')).toBeVisible()
})
