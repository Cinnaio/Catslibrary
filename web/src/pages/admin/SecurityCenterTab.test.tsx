import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SECURITY_POLICY, type SecurityOverview, type SecurityPolicy } from '@shared/security'
// jsdom 缺少 Radix Select 使用的指针捕获接口。
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}
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
  await screen.findByText('还没有邮件记录')
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(screen.queryByRole('tab', { name: '防护策略' })).not.toBeInTheDocument()
  expect(mock.request.mock.calls.every((call) => call[1].includes('/mail?'))).toBe(true)
})
it('读取失败提供重试，不显示成空列表', async () => {
  mock.request.mockRejectedValueOnce(new Error('记录读取失败'))
  show('mail')
  await screen.findByRole('button', { name: /重试/ })
  expect(screen.queryByText('还没有邮件记录')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /重试/ }))
  await screen.findByText('还没有邮件记录')
})
it('切换分区保留策略与邮件配置草稿', async () => {
  const user = userEvent.setup()
  show('policy')
  await screen.findByLabelText('每日总预算')
  fireEvent.change(screen.getByLabelText('每日总预算'), { target: { value: '88' } })
  await user.click(screen.getByRole('switch', { name: /^仅允许白名单域名/ }))
  fireEvent.change(screen.getByLabelText('域名白名单'), { target: { value: ' Example.COM \n' } })
  fireEvent.change(screen.getByLabelText('域名黑名单'), { target: { value: 'blocked.test' } })
  await user.click(screen.getByRole('switch', { name: /^同时匹配子域名/ }))
  await user.click(screen.getByRole('tab', { name: '邮件服务' }))
  await screen.findByLabelText('SMTP 服务器')
  fireEvent.change(screen.getByLabelText('SMTP 服务器'), { target: { value: 'draft.example.test' } })
  await user.click(screen.getByRole('tab', { name: '防护策略' }))
  expect(screen.getByLabelText('每日总预算')).toHaveValue(88)
  expect(screen.getByLabelText('域名白名单')).toHaveValue(' Example.COM \n')
  expect(screen.getByLabelText('域名黑名单')).toHaveValue('blocked.test')
  expect(screen.getByRole('switch', { name: /^仅允许白名单域名/ })).toBeChecked()
  expect(screen.getByRole('switch', { name: /^同时匹配子域名/ })).toBeChecked()
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

it('无效预算不能进入保存确认，修正后仍使用原策略草稿', async () => {
  show('policy')
  await screen.findByLabelText('每日总预算')
  fireEvent.change(screen.getByLabelText('每日应急预留'), { target: { value: '80' } })
  expect(screen.getByRole('button', { name: '保存策略' })).toBeDisabled()
  expect(screen.getByText('应急预留须小于每日总预算')).toBeInTheDocument()
  expect(mock.request.mock.calls.every((call) => call[0] === 'GET')).toBe(true)
  fireEvent.change(screen.getByLabelText('每日总预算'), { target: { value: '100' } })
  fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('保存防护策略')
})
it('白名单为空或域名无效时禁止保存，修正后提交名单并显示服务端规范化结果', async () => {
  let saved = structuredClone(DEFAULT_SECURITY_POLICY)
  const emailDomains = { allowlistEnabled: true, includeSubdomains: false, allowlist: ['example.com'], blocklist: ['blocked.test'] }
  mock.request.mockImplementation(async (method: string, path: string, body?: { policy: SecurityPolicy }) => {
    if (method === 'PUT' && path.endsWith('/policy')) {
      saved = { ...body!.policy, revision: 1, emailDomains }
      return structuredClone(saved)
    }
    return { ...overview, policy: structuredClone(saved) }
  })
  show('policy')
  await screen.findByLabelText('域名白名单')
  fireEvent.click(screen.getByRole('switch', { name: /^仅允许白名单域名/ }))
  expect(screen.getByLabelText('域名白名单')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: '保存策略' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('域名白名单'), { target: { value: 'user@example.com' } })
  expect(screen.getByText(/第 1 行不是有效域名/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存策略' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('域名白名单'), { target: { value: ' EXAMPLE.COM \nexample.com\n' } })
  fireEvent.change(screen.getByLabelText('域名黑名单'), { target: { value: '*.blocked.test' } })
  expect(screen.getByLabelText('域名黑名单')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: '保存策略' })).toBeDisabled()
  expect(mock.request.mock.calls.every((call) => call[0] === 'GET')).toBe(true)
  fireEvent.change(screen.getByLabelText('域名黑名单'), { target: { value: 'blocked.test' } })
  expect(screen.getByRole('button', { name: '保存策略' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
  fireEvent.change(screen.getByLabelText('操作原因'), { target: { value: '限制账号邮件域名' } })
  fireEvent.click(screen.getByRole('button', { name: '确认操作' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(mock.request).toHaveBeenCalledWith(
    'PUT',
    '/admin/security/policy',
    {
      policy: expect.objectContaining({ emailDomains: { ...emailDomains, allowlist: [' EXAMPLE.COM ', 'example.com', ''] } }),
      reason: '限制账号邮件域名',
    },
    true,
  )
  expect(screen.getByLabelText('域名白名单')).toHaveValue('example.com')
  expect(screen.queryByRole('button', { name: '保存策略' })).not.toBeInTheDocument()
})
it('邮件详情先显示加载，关闭后忽略迟到响应并恢复入口焦点', async () => {
  const user = userEvent.setup()
  const record = {
    id: 'mail-fixture',
    recipient_hint: 'a***@example.test',
    purpose: 'reset-password',
    state: 'unknown',
    emergency: false,
    attempts: 1,
    error_code: 'smtp_unknown',
    created_at: Date.now(),
    updated_at: Date.now(),
    user_id: 'reader',
    provider_id: '',
    transport: 'smtp',
  }
  let finish!: (value: unknown) => void
  mock.request.mockImplementation(async (_method: string, path: string) =>
    path.endsWith('/mail/mail-fixture')
      ? await new Promise((resolve) => {
          finish = resolve
        })
      : { items: [record], total: 1 },
  )
  show('mail')
  const trigger = await screen.findByRole('button', { name: '查看' })
  await user.click(trigger)
  expect(screen.getByRole('dialog')).toHaveTextContent('读取投递过程')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  finish({ attempts: [], events: [] })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
it('账号验证例外限制为邮箱绑定，禁止选择邮箱验证豁免', async () => {
  const user = userEvent.setup()
  show('restrictions')
  await screen.findByText('暂无生效中的规则')
  await user.click(screen.getByRole('button', { name: '新增规则' }))
  await user.click(screen.getByLabelText('处理方式'))
  expect(screen.getByRole('option', { name: '仅豁免人机验证' })).toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Escape}')
  await user.click(screen.getByLabelText('目标类型'))
  await user.click(screen.getByRole('option', { name: '账号 ID' }))
  await user.click(screen.getByLabelText('处理方式'))
  await user.click(screen.getByRole('option', { name: '仅豁免人机验证' }))
  expect(screen.getByLabelText('适用场景')).toBeDisabled()
  expect(screen.getByLabelText('适用场景')).toHaveTextContent('绑定与更换邮箱')
})
