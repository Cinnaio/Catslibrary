import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupImpactReport, BackupImpactSummary, BackupTask } from '@shared/backups'
import { BACKUP_IMPACT_GROUPS } from '@shared/backups'
import BackupImpactDialog from './BackupImpactDialog'

const mock = vi.hoisted(() => ({ impact: vi.fn(), checkImpact: vi.fn(), toast: vi.fn() }))
vi.mock('@/lib/backups-api', () => ({ backupsApi: mock }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mock.toast }) }))
const counts = { current: 2, restored: 1, added: 0, modified: 1, removed: 1, currentBytes: 0, restoredBytes: 0 }
const summary: BackupImpactSummary = {
  groups: Object.fromEntries(BACKUP_IMPACT_GROUPS.map((group) => [group, { ...counts }])) as BackupImpactSummary['groups'],
  tables: [],
  schemaChanges: [],
}
const task: BackupTask = {
  id: 'preview',
  versionId: 'version',
  actor: '管理员',
  kind: 'preview',
  state: 'completed',
  stage: '',
  createdAt: 1,
  finishedAt: 2,
  error: '',
  result: { previewToken: 'fixture-token', impact: summary },
}
const report = (): BackupImpactReport => ({
  taskId: task.id,
  versionId: task.versionId,
  snapshotAt: 1,
  completedAt: 2,
  expiresAt: Date.now() + 600000,
  summary,
  preserved: ['服务器部署配置', '备份控制记录'],
  notes: ['会话统一失效，正文与凭据不展示'],
  items: { total: 21, items: [{ sequence: 1, group: 'novels', table: 'novels', change: 'remove', name: '线上独有小说', quantity: 1, changedFields: [] }] },
})
function show() {
  const callbacks = { onClose: vi.fn(), onContinue: vi.fn(), onRepreview: vi.fn().mockResolvedValue(undefined) }
  render(<BackupImpactDialog task={task} {...callbacks} />)
  return callbacks
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.impact.mockResolvedValue(report())
  mock.checkImpact.mockResolvedValue({ fresh: true, checkedAt: Date.now(), message: '有效' })
})
afterEach(() => vi.useRealTimers())
describe('回滚影响预览', () => {
  it('展示方向、摘要及保留项，继续前检查报告有效性', async () => {
    const callbacks = show()
    await screen.findByText('线上独有小说')
    expect(screen.getByText('回滚将移除')).toBeInTheDocument()
    expect(screen.getByText('服务器部署配置')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续确认回滚' }))
    await waitFor(() => expect(callbacks.onContinue).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'version', summary })))
    expect(mock.checkImpact).toHaveBeenCalledWith('preview', 'version')
  })
  it('线上数据变化后禁止继续，允许重新预检', async () => {
    mock.checkImpact.mockResolvedValue({ fresh: false, checkedAt: 1, message: '线上业务数据已变化，请重新预检' })
    const callbacks = show()
    await screen.findByText('线上独有小说')
    fireEvent.click(screen.getByRole('button', { name: '继续确认回滚' }))
    await screen.findByText('线上业务数据已变化，请重新预检')
    expect(callbacks.onContinue).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '继续确认回滚' })).toBeDisabled()
    expect(mock.toast).toHaveBeenCalledWith('线上业务数据已变化，请重新预检', 'error')
    fireEvent.click(screen.getByRole('button', { name: '重新预检' }))
    await waitFor(() => expect(callbacks.onRepreview).toHaveBeenCalledOnce())
  })
  it('读取失败不能显示为零差异或继续回滚', async () => {
    mock.impact.mockRejectedValue(new Error('没有完整的回滚影响报告'))
    const callbacks = show()
    await screen.findByText('没有完整的回滚影响报告')
    expect(screen.queryByLabelText('回滚影响摘要')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续确认回滚' })).toBeDisabled()
    expect(callbacks.onContinue).not.toHaveBeenCalled()
  })
  it('分页和分组筛选使用服务端分页，并重置页码', async () => {
    mock.impact.mockImplementation(async (_id, page, group) => ({
      ...report(),
      items: { total: 21, items: [{ ...report().items.items[0]!, sequence: page, name: group ? '章节变化记录' : `第${page}页记录` }] },
    }))
    show()
    await screen.findByText('第1页记录')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('第2页记录')
    expect(mock.impact).toHaveBeenLastCalledWith('preview', 2, '', '')
    fireEvent.click(screen.getByRole('combobox', { name: '差异类型' }))
    fireEvent.click(screen.getByRole('option', { name: '章节' }))
    await screen.findByText('章节变化记录')
    expect(mock.impact).toHaveBeenLastCalledWith('preview', 1, 'chapters', '')
  })
  it('校验请求失败仍禁止继续；处理中不能关闭弹窗', async () => {
    let fail!: (error: Error) => void
    mock.checkImpact.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      }),
    )
    const callbacks = show()
    await screen.findByText('线上独有小说')
    fireEvent.click(screen.getByRole('button', { name: '继续确认回滚' }))
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    await act(async () => {
      fail(new Error('无法核对差异'))
    })
    await screen.findByText('无法核对差异')
    expect(screen.getByRole('button', { name: '继续确认回滚' })).toBeDisabled()
    expect(callbacks.onContinue).not.toHaveBeenCalled()
  })
  it('报告在弹窗打开期间过期时，自动禁用继续按钮', async () => {
    vi.useFakeTimers()
    mock.impact.mockResolvedValue({ ...report(), expiresAt: Date.now() + 1500 })
    await act(async () => {
      show()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('button', { name: '继续确认回滚' })).toBeEnabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByRole('button', { name: '继续确认回滚' })).toBeDisabled()
    expect(screen.getByText('报告已过期，请重新预检。')).toBeInTheDocument()
  })
})
