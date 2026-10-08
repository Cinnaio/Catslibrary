import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupOverview } from '@shared/backups'

const mock = vi.hoisted(() => ({
  overview: vi.fn(),
  settings: vi.fn(),
  saveSettings: vi.fn(),
  versions: vi.fn(),
  logs: vi.fn(),
  backup: vi.fn(),
  savePolicy: vi.fn(),
  saveTarget: vi.fn(),
  preview: vi.fn(),
  task: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/lib/backups-api', () => ({ backupsApi: mock, saveBlob: vi.fn() }))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mock.toast }), useConfirm: () => ({ confirm: mock.confirm }) }))
import BackupsTab from './BackupsTab'

const overview: BackupOverview = {
  policy: {
    enabled: false,
    schedule: 'daily',
    time: '03:00',
    timezone: 'Asia/Shanghai',
    weekday: 0,
    intervalHours: 24,
    targetIds: [],
    localRetention: 7,
    nextRunAt: 0,
    revision: 0,
  },
  targets: [],
  capabilities: { encryption: true, dump: true, restore: true, transfer: true, rehearsal: true, allowedHosts: ['backup.example.com'] },
  maintenance: false,
  tasks: [],
}
function show(view = 'versions') {
  return render(
    <MemoryRouter initialEntries={[`/admin/backups?view=${view}`]}>
      <BackupsTab />
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.overview.mockResolvedValue(structuredClone(overview))
  mock.versions.mockResolvedValue({ items: [], total: 0 })
  mock.logs.mockResolvedValue({ items: [], total: 0 })
})
describe('备份后台', () => {
  it('缺少实际依赖时禁止创建备份，并显示具体缺项', async () => {
    mock.overview.mockResolvedValue({ ...overview, capabilities: { ...overview.capabilities, encryption: false } })
    show()
    await screen.findByText('部署准备')
    expect(screen.getByRole('button', { name: '立即备份' })).toBeDisabled()
    expect(screen.getByText(/尚未就绪/)).toHaveTextContent('备份主密钥')
  })
  it('手动备份使用明确选中的目标与备注，展示异步任务', async () => {
    mock.backup.mockResolvedValue({ id: 'task-1', kind: 'backup', state: 'queued' })
    mock.task.mockResolvedValue({ id: 'task-1', kind: 'backup', state: 'queued', actor: '管理员', createdAt: 1, stage: '等待执行', result: null })
    show()
    await waitFor(() => expect(screen.getByRole('button', { name: '立即备份' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '立即备份' }))
    fireEvent.change(screen.getByLabelText('版本备注'), { target: { value: '升级前' } })
    fireEvent.click(screen.getByRole('button', { name: '开始备份' }))
    await waitFor(() => expect(mock.backup).toHaveBeenCalledWith([], '升级前'))
    await screen.findByRole('dialog', { name: '备份' })
  })
  it('计划保存失败保留草稿，保存按钮只在修改后开放', async () => {
    mock.savePolicy.mockRejectedValue(new Error('保存失败'))
    show('schedule')
    await screen.findByLabelText('本地保留版本数量')
    expect(screen.getByRole('button', { name: '保存计划' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('本地保留版本数量'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }))
    await screen.findByText('保存失败')
    expect(screen.getByLabelText('本地保留版本数量')).toHaveValue(12)
    expect(mock.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, localRetention: 12 }))
  })
  it('新增 SFTP 目标包含服务器公钥及必需副本设置，保存失败保留密码输入', async () => {
    mock.saveTarget.mockRejectedValue(new Error('允许列表尚未配置'))
    show('targets')
    await screen.findByText('本地存储')
    fireEvent.click(screen.getByRole('button', { name: '添加服务器' }))
    fireEvent.change(screen.getByLabelText('目标名称'), { target: { value: '我的服务器' } })
    fireEvent.change(screen.getByLabelText('服务器主机'), { target: { value: 'backup.example.com' } })
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'backup' } })
    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'private' } })
    fireEvent.change(screen.getByLabelText('服务器公钥'), { target: { value: 'ssh-ed25519 AAAA' } })
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))
    await screen.findByText('允许列表尚未配置')
    expect(screen.getByLabelText('登录密码')).toHaveValue('private')
    expect(mock.saveTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'sftp', required: true, password: 'private' }))
  })
  it('版本详情只提供预检入口，缺少演练库时不能跳过预检直接恢复', async () => {
    mock.overview.mockResolvedValue({ ...overview, capabilities: { ...overview.capabilities, rehearsal: false } })
    mock.versions.mockResolvedValue({
      items: [
        {
          id: 'version-1',
          createdAt: 1,
          state: 'completed',
          size: 500,
          digest: 'digest',
          note: '测试版本',
          pinned: false,
          protection: false,
          trigger: 'manual',
          migrationVersion: 47,
          copies: [{ targetId: 'local', name: '本地', state: 'available', verifiedAt: 1, error: '' }],
        },
      ],
      total: 1,
    })
    show()
    await screen.findByText('测试版本')
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    expect(screen.getByRole('button', { name: '预检恢复此版本' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '创建保护备份并回滚' })).not.toBeInTheDocument()
  })
})

describe('前端备份设置', () => {
  const settings = {
    revision: 0,
    hostSource: 'environment',
    allowedHosts: ['backup.example.com'],
    rehearsalSource: 'environment',
    rehearsalConfigured: false,
    rehearsalLabel: '',
    retryLimit: 3,
    logRetentionDays: 180,
  }
  const deployment = {
    environmentAllowedHosts: ['backup.example.com'],
    localDirectory: '/data/backups',
    keyId: 'default',
    encryption: true,
    dump: true,
    restore: true,
    transfer: true,
  }
  beforeEach(() => mock.settings.mockResolvedValue({ settings, deployment }))
  it('编辑重试和保留期限，失败保持草稿并可撤销', async () => {
    mock.saveSettings.mockRejectedValue(new Error('设置已更新，请重新加载'))
    show('settings')
    await screen.findByLabelText('远程失败自动重试次数')
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
    expect(screen.getByLabelText('允许连接的服务器')).toBeDisabled()
    expect(screen.getByText('/data/backups')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('常规日志保留天数'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('设置已更新，请重新加载')
    expect(mock.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ retryLimit: 0, logRetentionDays: 90, hostSource: 'environment' }))
    expect(screen.getByLabelText('常规日志保留天数')).toHaveValue(90)
    fireEvent.click(screen.getByRole('button', { name: '撤销修改' }))
    expect(screen.getByLabelText('常规日志保留天数')).toHaveValue(180)
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  })
  it('维护期间禁用设置保存', async () => {
    mock.overview.mockResolvedValue({ ...overview, maintenance: true })
    show('settings')
    await screen.findByText('本地与运行环境')
    expect(screen.getByLabelText('常规日志保留天数')).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  })
})
