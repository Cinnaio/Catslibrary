import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupDeployment, BackupSettingsPage } from '@shared/backups'
import BackupSettingsForm from './BackupSettingsForm'
const mock = vi.hoisted(() => ({
  saveDeployment: vi.fn(),
  detectDeployment: vi.fn(),
  generateDeploymentKey: vi.fn(),
  saveSettings: vi.fn(),
  rehearsalInfo: vi.fn().mockResolvedValue(null),
  checkRehearsal: vi.fn(),
  removeRehearsal: vi.fn(),
  createRehearsal: vi.fn(),
  saveBlob: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/components/feedback', () => ({ useToast: () => ({ toast: mock.toast }), useConfirm: () => ({ confirm: mock.confirm }) }))
vi.mock('@/lib/backups-api', () => ({ backupsApi: mock, saveBlob: mock.saveBlob }))
const runtime: BackupDeployment = {
  revision: 0,
  keyConfigured: false,
  keySource: 'missing',
  keyId: 'default',
  configFile: '/data/backup-config.json',
  tools: Object.fromEntries(
    ['dump', 'restore', 'psql', 'transfer'].map((name) => [
      name,
      { configuredPath: '', effectivePath: name, source: 'automatic', ready: false, version: '', error: '尚未安装' },
    ]),
  ) as BackupDeployment['tools'],
}
const page: BackupSettingsPage = {
  settings: {
    revision: 0,
    hostSource: 'environment',
    allowedHosts: [],
    rehearsalSource: 'disabled',
    rehearsalConfigured: false,
    rehearsalLabel: '',
    retryLimit: 3,
    logRetentionDays: 180,
  },
  deployment: {
    localDirectory: '/data/backups',
    environmentAllowedHosts: [],
    keyId: 'default',
    encryption: false,
    dump: false,
    restore: false,
    transfer: false,
    runtime,
  },
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.rehearsalInfo.mockResolvedValue(null)
})
const configuredPage: BackupSettingsPage = {
  ...page,
  settings: { ...page.settings, rehearsalSource: 'custom', rehearsalConfigured: true, rehearsalLabel: 'database:5432/shadow' },
  deployment: { ...page.deployment, encryption: true },
}
const rehearsal = {
  revision: 0,
  source: 'custom',
  configured: true,
  host: 'database',
  port: '5432',
  database: 'shadow',
  connectionStatus: 'unchecked',
  guardStatus: 'unchecked',
  checkedAt: 0,
  error: '',
  lastPreview: null,
}
describe('演练库管理', () => {
  it('查看脱敏信息并检查连接，复用统一结果反馈', async () => {
    mock.rehearsalInfo.mockResolvedValue(rehearsal)
    mock.checkRehearsal.mockResolvedValue({ ...rehearsal, connectionStatus: 'connected', guardStatus: 'valid', checkedAt: 1 })
    render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={vi.fn()} />)
    expect(screen.queryByText('shadow')).not.toBeInTheDocument()
    expect(mock.rehearsalInfo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /演练库信息/ }))
    await screen.findByRole('dialog', { name: '演练库信息' })
    await screen.findByText('shadow')
    expect(screen.getByText('5432')).toBeInTheDocument()
    expect(screen.getByText('暂无当前演练库的预检记录')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }))
    await screen.findByText('可连接')
    expect(screen.getByText('有效')).toBeInTheDocument()
    expect(mock.checkRehearsal).toHaveBeenCalledWith(0)
    expect(mock.toast).toHaveBeenCalledWith('演练库连接与保护标记检查通过', 'success')
    expect(mock.saveSettings).not.toHaveBeenCalled()
  })
  it('检查期间禁止关闭，完成后关闭返回入口焦点，重开重新读取信息', async () => {
    mock.rehearsalInfo.mockResolvedValue(rehearsal)
    let finishCheck!: (value: typeof rehearsal) => void
    mock.checkRehearsal.mockReturnValue(
      new Promise((resolve) => {
        finishCheck = resolve
      }),
    )
    render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /演练库信息/ })
    fireEvent.click(trigger)
    await screen.findByText('shadow')
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }))
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '演练库信息' })).toBeInTheDocument()
    await act(async () => {
      finishCheck(rehearsal)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    fireEvent.click(trigger)
    await waitFor(() => expect(mock.rehearsalInfo).toHaveBeenCalledTimes(2))
  })
  it('信息读取晚于连接检查返回时，不覆盖新检查结果', async () => {
    let finishRead!: (value: typeof rehearsal) => void
    mock.rehearsalInfo.mockReturnValue(
      new Promise((resolve) => {
        finishRead = resolve
      }),
    )
    mock.checkRehearsal.mockResolvedValue({ ...rehearsal, connectionStatus: 'connected', guardStatus: 'valid', checkedAt: 1 })
    render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /演练库信息/ }))
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }))
    await screen.findByText('可连接')
    finishRead(rehearsal)
    await waitFor(() => expect(screen.getByRole('button', { name: '检查连接' })).toBeEnabled())
    expect(screen.getByText('可连接')).toBeInTheDocument()
    expect(screen.getByText('有效')).toBeInTheDocument()
  })
  it('检查失败显示原因，保留设置草稿', async () => {
    mock.rehearsalInfo.mockResolvedValue(rehearsal)
    mock.checkRehearsal.mockResolvedValue({ ...rehearsal, connectionStatus: 'unavailable', checkedAt: 1, error: '演练数据库连接失败' })
    render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /演练库信息/ }))
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }))
    await screen.findByText('演练数据库连接失败')
    expect(mock.toast).toHaveBeenCalledWith('演练数据库连接失败', 'error')
    expect(screen.getByLabelText('远程失败自动重试次数')).toHaveValue(0)
  })
  it('取消移除不改变连接，维护期间禁用两个操作', async () => {
    mock.rehearsalInfo.mockResolvedValue(rehearsal)
    mock.confirm.mockResolvedValue(false)
    const { rerender } = render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /演练库信息/ }))
    fireEvent.click(screen.getByRole('button', { name: '移除连接配置' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '移除连接配置' })).toBeEnabled())
    expect(mock.removeRehearsal).not.toHaveBeenCalled()
    expect(mock.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('数据库及其中的数据会保留') }))
    rerender(<BackupSettingsForm page={configuredPage} disabled={true} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移除连接配置' })).toBeDisabled()
  })
  it('移除立即生效，保留其他草稿并更新保存版本', async () => {
    mock.rehearsalInfo.mockResolvedValue(rehearsal)
    mock.confirm.mockResolvedValue(true)
    const value = { ...page.settings, revision: 1, rehearsalSource: 'disabled' as const }
    mock.removeRehearsal.mockResolvedValue({ settings: value })
    mock.saveSettings.mockResolvedValue({ ...value, revision: 2, retryLimit: 0 })
    const onSaved = vi.fn()
    render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /演练库信息/ }))
    fireEvent.click(screen.getByRole('button', { name: '移除连接配置' }))
    await screen.findByText('演练库连接配置已移除，数据库已保留')
    expect(mock.removeRehearsal).toHaveBeenCalledWith(0)
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByLabelText('远程失败自动重试次数')).toHaveValue(0)
    expect(screen.queryByRole('button', { name: '检查连接' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(mock.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, rehearsalSource: 'disabled', retryLimit: 0 })))
    expect(mock.toast).toHaveBeenCalledWith('演练库连接配置已移除，数据库已保留', 'success')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('移除失败保留连接与草稿，可再次操作', async () => {
    mock.rehearsalInfo.mockResolvedValue(rehearsal)
    mock.confirm.mockResolvedValue(true)
    mock.removeRehearsal.mockRejectedValue(new Error('恢复预检任务尚未结束'))
    render(<BackupSettingsForm page={configuredPage} disabled={false} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /演练库信息/ }))
    fireEvent.click(screen.getByRole('button', { name: '移除连接配置' }))
    await screen.findByText('恢复预检任务尚未结束')
    expect(mock.toast).toHaveBeenCalledWith('恢复预检任务尚未结束', 'error')
    expect(screen.getByRole('button', { name: '检查连接' })).toBeEnabled()
    expect(screen.getByLabelText('远程失败自动重试次数')).toHaveValue(0)
  })
})
describe('备份本地配置编辑', () => {
  it('一键创建成功立即保存演练配置，保留其他草稿并使用新 revision', async () => {
    const value = {
      ...page.settings,
      revision: 1,
      rehearsalSource: 'custom' as const,
      rehearsalConfigured: true,
      rehearsalLabel: 'database/zhi_zhou_rehearsal_fixture',
    }
    mock.createRehearsal.mockResolvedValue({ settings: value })
    mock.saveSettings.mockResolvedValue({ ...value, revision: 2, retryLimit: 0 })
    const onSaved = vi.fn()
    render(<BackupSettingsForm page={{ ...page, deployment: { ...page.deployment, encryption: true } }} disabled={false} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '一键创建演练库' }))
    await screen.findByText('演练库已创建并保存，可用于恢复预检。')
    expect(mock.createRehearsal).toHaveBeenCalledWith(0)
    expect(mock.toast).toHaveBeenCalledWith('演练库已创建并保存，可用于恢复预检。', 'success')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByLabelText('远程失败自动重试次数')).toHaveValue(0)
    expect(screen.getByLabelText('演练数据库连接地址')).toHaveValue('')
    expect(screen.queryByRole('button', { name: '一键创建演练库' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(mock.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, rehearsalSource: 'custom', retryLimit: 0 })))
  })
  it('创建失败显示原因并保留其他输入，可再次尝试', async () => {
    mock.createRehearsal.mockRejectedValue(new Error('当前数据库账号没有 CREATEDB 权限'))
    render(<BackupSettingsForm page={{ ...page, deployment: { ...page.deployment, encryption: true } }} disabled={false} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('常规日志保留天数'), { target: { value: '365' } })
    fireEvent.click(screen.getByRole('button', { name: '一键创建演练库' }))
    await screen.findByText('当前数据库账号没有 CREATEDB 权限')
    expect(mock.toast).toHaveBeenCalledWith('当前数据库账号没有 CREATEDB 权限', 'error')
    expect(screen.getByLabelText('常规日志保留天数')).toHaveValue(365)
    expect(screen.getByRole('button', { name: '一键创建演练库' })).toBeEnabled()
  })
  it('缺少主密钥或处于维护状态时不能创建', () => {
    const { rerender } = render(<BackupSettingsForm page={page} disabled={false} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: '一键创建演练库' })).toBeDisabled()
    rerender(<BackupSettingsForm page={{ ...page, deployment: { ...page.deployment, encryption: true } }} disabled={true} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: '一键创建演练库' })).toBeDisabled()
  })
  it('保留其他草稿时配置主密钥后，立即允许一键创建演练库', async () => {
    mock.saveDeployment.mockResolvedValue({ deployment: { ...runtime, revision: 1, keyConfigured: true, keySource: 'local' } })
    render(<BackupSettingsForm page={page} disabled={false} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /主密钥/ }))
    fireEvent.change(screen.getByLabelText('备份主密钥'), { target: { value: 'fixture-key' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '一键创建演练库' })).toBeEnabled()
    expect(screen.getByLabelText('远程失败自动重试次数')).toHaveValue(0)
  })
  it('检测草稿不保存，失败保留路径，撤销恢复原值', async () => {
    mock.detectDeployment.mockResolvedValue({ deployment: runtime })
    mock.saveDeployment.mockRejectedValue(new Error('路径检测失败'))
    render(<BackupSettingsForm page={page} disabled={false} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /数据库导出工具/ }))
    fireEvent.change(screen.getByLabelText('数据库导出工具'), { target: { value: '/tools/pg_dump' } })
    expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '检测工具' }))
    await waitFor(() => expect(mock.detectDeployment).toHaveBeenCalled())
    expect(mock.saveDeployment).not.toHaveBeenCalled()
    expect(mock.toast).toHaveBeenCalledWith('工具检测完成，未就绪：pg_dump', 'error')
    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await screen.findByText('路径检测失败')
    expect(mock.toast).toHaveBeenCalledWith('路径检测失败', 'error')
    expect(screen.getByLabelText('数据库导出工具')).toHaveValue('/tools/pg_dump')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: /数据库导出工具/ }))
    expect(screen.getByLabelText('数据库导出工具')).toHaveValue('')
  })
  it('服务端生成密钥后先导出，点击保存才持久化', async () => {
    const masterKey = 'unit-test-generated-key'
    mock.generateDeploymentKey.mockResolvedValue({ masterKey, keyId: 'default' })
    mock.saveDeployment.mockResolvedValue({ deployment: { ...runtime, revision: 1, keyConfigured: true, keySource: 'local' } })
    const onSaved = vi.fn()
    render(<BackupSettingsForm page={page} disabled={false} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /主密钥/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成并导出密钥' }))
    await waitFor(() => expect(mock.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'zhi-zhou-backup-master-key.json'))
    expect(mock.saveDeployment).not.toHaveBeenCalled()
    expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining('尚未保存'), 'success')
    expect(screen.getByLabelText('备份主密钥')).toHaveValue(masterKey)
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mock.saveDeployment).toHaveBeenCalledWith(expect.objectContaining({ masterKey }))
    expect(mock.saveSettings).not.toHaveBeenCalled()
    expect(mock.toast).toHaveBeenCalledWith('本地运行配置已保存，新任务立即使用。', 'success')
    expect(mock.toast).not.toHaveBeenCalledWith('备份设置已保存', 'success')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /主密钥/ }))
    expect(screen.getByLabelText('备份主密钥')).toHaveValue('')
    expect(screen.getByLabelText('备份主密钥')).toBeDisabled()
  })
  it('弹窗独立保存不丢失其他设置草稿，业务保存失败不重复写本地文件', async () => {
    mock.saveDeployment.mockResolvedValue({
      deployment: { ...runtime, revision: 1, tools: { ...runtime.tools, dump: { ...runtime.tools.dump, configuredPath: '/tools/pg_dump', ready: true } } },
    })
    mock.saveSettings.mockRejectedValueOnce(new Error('业务设置冲突')).mockResolvedValue({ ...page.settings, revision: 1, retryLimit: 0 })
    const onSaved = vi.fn()
    render(<BackupSettingsForm page={page} disabled={false} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('远程失败自动重试次数'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /数据库导出工具/ }))
    fireEvent.change(screen.getByLabelText('数据库导出工具'), { target: { value: '/tools/pg_dump' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByLabelText('远程失败自动重试次数')).toHaveValue(0)
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await screen.findByText('业务设置冲突')
    expect(mock.toast).toHaveBeenCalledWith('业务设置冲突', 'error')
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(mock.saveSettings).toHaveBeenCalledTimes(2))
    expect(mock.saveDeployment).toHaveBeenCalledTimes(1)
  })
  it('恢复工具同时配置 pg_restore 与 psql，取消不保存', () => {
    render(<BackupSettingsForm page={page} disabled={false} onSaved={vi.fn()} />)
    expect(screen.queryByLabelText('管理员密码')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /数据库恢复工具/ }))
    expect(screen.getByLabelText('数据库恢复工具')).toBeInTheDocument()
    expect(screen.getByLabelText('数据库执行工具')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('数据库执行工具'), { target: { value: '/tools/psql' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(mock.saveDeployment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /数据库恢复工具/ }))
    expect(screen.getByLabelText('数据库执行工具')).toHaveValue('')
  })
  it('维护期间禁止打开配置弹窗', () => {
    render(<BackupSettingsForm page={page} disabled={true} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: /主密钥/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /数据库导出工具/ })).toBeDisabled()
  })
})
