import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync, lstatSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { PROJECT_ROOT } from '../../config'
import { BackupError } from './errors'

export const toolNames = ['dump', 'restore', 'psql', 'transfer'] as const
export type ToolName = (typeof toolNames)[number]
export interface DeploymentFile {
  revision: number
  masterKey?: string
  keyId?: string
  tools: Partial<Record<ToolName, string>>
}
export const deploymentFilePath = () => path.resolve(process.env.BACKUP_CONFIG_FILE || path.join(PROJECT_ROOT, 'data', 'backup-config.json'))
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, 'base64').length === 32

export function readDeploymentFile(): DeploymentFile {
  try {
    const file = deploymentFilePath()
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw new Error()
    const raw = JSON.parse(readFileSync(file, 'utf8')) as DeploymentFile
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 0 || !raw.tools || typeof raw.tools !== 'object' || Array.isArray(raw.tools)) throw new Error()
    if (raw.masterKey !== undefined && (!validKey(raw.masterKey) || typeof raw.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.keyId)))
      throw new Error()
    for (const name of toolNames)
      if (raw.tools[name] !== undefined && (typeof raw.tools[name] !== 'string' || !path.isAbsolute(raw.tools[name]!) || /[\r\n\0]/.test(raw.tools[name]!)))
        throw new Error()
    return raw
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, tools: {} }
    throw new BackupError('LOCAL_CONFIG_INVALID', '本地备份配置无法读取，请检查文件格式及访问权限', 500)
  }
}
export function prepareDeploymentFile(input: {
  revision: number
  tools: Record<ToolName, string>
  masterKey?: string
  persistCurrentKey?: boolean
}): DeploymentFile {
  const current = readDeploymentFile()
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision)
    throw new BackupError('REVISION_CONFLICT', '本地备份配置已更新，请刷新后重试', 409)
  if (!input.tools || typeof input.tools !== 'object' || Array.isArray(input.tools) || (input.masterKey !== undefined && typeof input.masterKey !== 'string'))
    throw new BackupError('INVALID_CONFIG', '本地备份配置无效')
  const tools: DeploymentFile['tools'] = {}
  for (const name of toolNames) {
    const value = input.tools[name]
    if (typeof value !== 'string' || value.length > 4096) throw new BackupError('INVALID_CONFIG', '请填写有效的工具路径')
    const trimmed = value.trim()
    if (trimmed && (!path.isAbsolute(trimmed) || /[\r\n\0]/.test(trimmed)))
      throw new BackupError('INVALID_CONFIG', '工具路径必须是服务器上的绝对路径，不能包含命令参数或换行')
    if (trimmed) tools[name] = trimmed
  }
  const existing = current.masterKey || process.env.BACKUP_ENCRYPTION_KEY || ''
  const requested = input.masterKey?.trim() || ''
  if (existing && requested && requested !== existing)
    throw new BackupError('KEY_ROTATION_REQUIRED', '已有主密钥不能直接替换；请保留当前密钥以读取历史备份和凭据', 409)
  if (input.persistCurrentKey !== undefined && typeof input.persistCurrentKey !== 'boolean') throw new BackupError('INVALID_CONFIG', '密钥保存选项无效')
  const masterKey = requested || current.masterKey || (input.persistCurrentKey ? existing : '')
  if (input.persistCurrentKey && !masterKey) throw new BackupError('KEY_UNAVAILABLE', '没有可保存的现有密钥')
  if (masterKey && !validKey(masterKey)) throw new BackupError('INVALID_CONFIG', '主密钥必须是 32 字节随机数据的 Base64')
  return { revision: current.revision + 1, tools, ...(masterKey ? { masterKey, keyId: current.keyId || process.env.BACKUP_KEY_ID || 'default' } : {}) }
}
export function writeDeploymentFile(value: DeploymentFile) {
  const file = deploymentFilePath(),
    dir = path.dirname(file)
  // Configuration is a deployment secret, never a downloadable web asset.
  for (const served of [path.join(PROJECT_ROOT, 'web'), process.env.WEB_DIST_DIR].filter(Boolean) as string[]) {
    const relative = path.relative(path.resolve(served), file)
    if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)))
      throw new BackupError('UNSAFE_DIRECTORY', '配置文件不能位于网站静态目录')
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n', 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, file)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}
