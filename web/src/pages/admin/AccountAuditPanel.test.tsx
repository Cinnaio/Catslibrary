import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true })
import AccountAuditPanel, { accountDeviceSummary, type LoginAudit, type AdminOperationAudit } from './AccountAuditPanel'
const login: LoginAudit = {
  avatarUrl: '/api/avatars/reader.png',
  id: 'login-1',
  userId: 'u',
  username: 'reader',
  displayName: '读者',
  status: 'limited',
  reason: 'rate_limited',
  ipAddress: '192.0.2.1',
  userAgent: 'Mozilla/5.0 Windows Chrome/140.0.0.0 Safari/537.36',
  createdAt: 1790820000000,
}
const operation: AdminOperationAudit = {
  actorAvatarUrl: '/api/avatars/admin.png',
  id: 'audit-1',
  operationId: 'full-operation-id-123456789',
  actorUserId: 'admin',
  actorUsername: 'admin',
  actorDisplayName: '管理员',
  action: 'set-password',
  targetCount: 2,
  status: 'failed',
  responseStatus: 503,
  replayCount: 3,
  error: '服务暂不可用',
  createdAt: 1790820000000,
  updatedAt: 1790820001000,
  finishedAt: 1790820001000,
}
const base = {
  total: 31,
  loading: false,
  status: 'all',
  onStatus: vi.fn(),
  onRefresh: vi.fn(),
  page: 1,
  limit: 15,
  onPage: vi.fn(),
  onLimit: vi.fn(),
  statusLabel: (v: string) => ({ limited: '限流', success: '成功', failure: '失败', pending: '处理中', completed: '成功', failed: '失败' })[v] || v,
}
describe('账户审计目录', () => {
  it('知舟 iOS App 在登录列表和详情中识别，保留完整原始 UA', async () => {
    const userAgent = 'ZhiZhou/16 CFNetwork/3896.100.1.2.1 Darwin/27.0.0'
    render(<AccountAuditPanel {...base} kind="login" records={[{ ...login, userAgent }]} />)
    expect(screen.getByText('知舟 iOS App')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '查看读者的登录记录详情' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('知舟 iOS App')).toBeInTheDocument()
    expect(dialog.getByText(userAgent)).toBeInTheDocument()
  })
  it('原生客户端识别兼容版本变化，不将其他 Apple 客户端或 Safari 误标为知舟 App', () => {
    expect(accountDeviceSummary('ZhiZhou/42 CFNetwork/4000 Darwin/28.1')).toBe('知舟 iOS App')
    expect(accountDeviceSummary('OtherApp/16 CFNetwork/3896 Darwin/27.0.0')).toBe('其他浏览器 · 其他设备')
    expect(accountDeviceSummary('ZhiZhou/16')).toBe('其他浏览器 · 其他设备')
    expect(accountDeviceSummary('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS')
    expect(accountDeviceSummary('')).toBe('未记录设备')
  })
  it('登录列表显示摘要，详情保留完整 User-Agent 与原因', async () => {
    const { container } = render(<AccountAuditPanel {...base} kind="login" records={[login]} reasonLabel={() => '尝试次数过多'} />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/avatars/reader.png')
    expect(screen.getByText('Chrome · Windows')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '查看读者的登录记录详情' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(login.userAgent)).toBeInTheDocument()
    expect(dialog.getByText('尝试次数过多')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('操作详情保留错误、完整 ID、响应码和重放信息', async () => {
    render(<AccountAuditPanel {...base} kind="operation" records={[operation]} actionLabel={() => '修改用户密码'} />)
    await userEvent.click(screen.getByRole('button', { name: '查看管理员的操作记录详情' }))
    const dialog = within(screen.getByRole('dialog'))
    for (const text of [operation.operationId, operation.error, 'HTTP 503', '修改用户密码', '3']) expect(dialog.getByText(text)).toBeInTheDocument()
  })
  it('分页与结果筛选继续交由调用方请求，加载时阻止重复刷新', async () => {
    const onPage = vi.fn(),
      onStatus = vi.fn()
    const { rerender } = render(<AccountAuditPanel {...base} kind="login" records={[login]} onPage={onPage} onStatus={onStatus} />)
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPage).toHaveBeenCalledWith(2)
    fireEvent.keyDown(screen.getByRole('combobox', { name: '登录结果' }), { key: 'ArrowDown' })
    await userEvent.click(screen.getByRole('option', { name: '限流' }))
    expect(onStatus).toHaveBeenCalledWith('limited')
    rerender(<AccountAuditPanel {...base} kind="login" records={[login]} loading />)
    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled()
  })
})
