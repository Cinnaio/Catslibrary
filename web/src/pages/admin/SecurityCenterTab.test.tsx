import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SECURITY_POLICY, type SecurityOverview } from '@shared/security'
const mock = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn(), user: { id: 'root', role: 'super_admin' } }))
vi.mock('@/lib/api', () => ({
  request: mock.request,
  authApi: {
    mailSettings: async () => ({
      revision: 0,
      ready: true,
      mode: 'smtp',
      source: 'local',
      host: 'smtp.example.test',
      port: 465,
      security: 'tls',
      username: 'user',
      passwordSet: true,
      from: 'account@example.test',
      publicOrigin: 'https://reader.example.test',
    }),
  },
}))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: mock.user }) }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mock.toast }) }))
import SecurityCenterTab from './SecurityCenterTab'
const overview: SecurityOverview = {
  policy: DEFAULT_SECURITY_POLICY,
  today: 3,
  month: 8,
  ordinaryToday: 3,
  ordinaryMonth: 8,
  queued: 0,
  unknown: 0,
  failed: 0,
  blocked: 0,
  accepted: 0,
  delivered: 0,
  encryptionReady: true,
  mailReady: true,
  turnstileReady: true,
  webhookReady: true,
  lastWebhookAt: 0,
  workerAt: Date.now(),
  nextResetAt: Date.now() + 10000,
  restoreHold: false,
  breakerUntil: 0,
  trend: [],
  alerts: [],
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.user = { id: 'root', role: 'super_admin' }
  mock.request.mockImplementation(async (_method: string, path: string) => (path.endsWith('/overview') ? structuredClone(overview) : { items: [], total: 0 }))
})
function show(view = 'overview') {
  return render(
    <MemoryRouter initialEntries={['/admin/security?view=' + view]}>
      <SecurityCenterTab />
    </MemoryRouter>,
  )
}
it('普通管理员只看到邮件与事件，不读取概览和策略', async () => {
  mock.user = { id: 'manager', role: 'admin' }
  show('mail')
  await screen.findByText('没有符合条件的记录')
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(screen.queryByRole('tab', { name: '防护策略' })).not.toBeInTheDocument()
  expect(mock.request.mock.calls.every((call) => call[1].includes('/mail?'))).toBe(true)
})
it('读取失败提供重试，不显示成空列表', async () => {
  mock.request.mockRejectedValueOnce(new Error('记录读取失败'))
  show('mail')
  await screen.findByRole('button', { name: /重试/ })
  expect(screen.queryByText('没有符合条件的记录')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /重试/ }))
  await screen.findByText('没有符合条件的记录')
})
it('切换分区保留策略与邮件配置草稿', async () => {
  const user = userEvent.setup()
  show('policy')
  await screen.findByLabelText('每日总预算')
  fireEvent.change(screen.getByLabelText('每日总预算'), { target: { value: '88' } })
  await user.click(screen.getByRole('tab', { name: '邮件服务' }))
  await screen.findByLabelText('SMTP 服务器')
  fireEvent.change(screen.getByLabelText('SMTP 服务器'), { target: { value: 'draft.example.test' } })
  await user.click(screen.getByRole('tab', { name: '防护策略' }))
  expect(screen.getByLabelText('每日总预算')).toHaveValue(88)
  await user.click(screen.getByRole('tab', { name: '邮件服务' }))
  expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('draft.example.test')
})
it('策略保存失败保留原因与草稿，确认提交使用原快照', async () => {
  show('policy')
  await screen.findByLabelText('每日总预算')
  fireEvent.change(screen.getByLabelText('每日总预算'), { target: { value: '88' } })
  fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
  fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '调整每日预算' } })
  mock.request.mockRejectedValueOnce(new Error('策略已更新，请刷新'))
  fireEvent.click(screen.getByRole('button', { name: '确认操作' }))
  await screen.findByText('策略已更新，请刷新')
  expect(screen.getByLabelText('操作原因')).toHaveValue('调整每日预算')
  expect(mock.request).toHaveBeenCalledWith('PUT', '/admin/security/policy', { policy: expect.objectContaining({ daily: 88 }), reason: '调整每日预算' }, true)
})
it('切换账号清除旧记录与策略草稿', async () => {
  const mounted = show('policy')
  await screen.findByLabelText('每日总预算')
  fireEvent.change(screen.getByLabelText('每日总预算'), { target: { value: '88' } })
  mock.user = { id: 'manager', role: 'admin' }
  mounted.rerender(
    <MemoryRouter initialEntries={['/admin/security?view=mail']}>
      <SecurityCenterTab />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.queryByLabelText('每日总预算')).not.toBeInTheDocument())
  expect(screen.getAllByRole('tab')).toHaveLength(2)
})
