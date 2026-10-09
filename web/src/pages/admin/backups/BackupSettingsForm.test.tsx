import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupDeployment, BackupSettingsPage } from '@shared/backups'
import BackupSettingsForm from './BackupSettingsForm'
const mock = vi.hoisted(() => ({
  saveDeployment: vi.fn(),
  detectDeployment: vi.fn(),
  generateDeploymentKey: vi.fn(),
  saveSettings: vi.fn(),
  createRehearsal: vi.fn(),
  saveBlob: vi.fn(),
}))
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
beforeEach(() => vi.resetAllMocks())
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
    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await screen.findByText('路径检测失败')
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
    expect(screen.getByLabelText('备份主密钥')).toHaveValue(masterKey)
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mock.saveDeployment).toHaveBeenCalledWith(expect.objectContaining({ masterKey }))
    expect(mock.saveSettings).not.toHaveBeenCalled()
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
