import type { BackupDeployment, BackupDeploymentInput, BackupToolStatus } from '@shared/backups'
import { command, toolDefaults } from './process'
import { encryptionReady, keyId, BACKUP_LOCK, BackupError } from './config'
import {
  deploymentFilePath,
  readDeploymentFile,
  prepareDeploymentFile,
  writeDeploymentFile,
  toolNames,
  type DeploymentFile,
  type ToolName,
} from './deployment-file'
import type { Db } from '../../db/pool'
import { first } from '../../db/query'
import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { DbClient } from '../../db/pool'

async function verifyRecoveredKey(db: DbClient, next: DeploymentFile) {
  if (!next.masterKey || encryptionReady()) return
  const derive = (purpose: string) => createHash('sha256').update(Buffer.from(next.masterKey!, 'base64')).update(`zhi-zhou-backups:${purpose}`).digest()
  const manifestRow = await first<{ manifest: string }>(
    db,
    "SELECT manifest FROM backup_control.versions WHERE manifest<>'' AND deleted=FALSE ORDER BY created_at DESC LIMIT 1",
  )
  try {
    if (manifestRow) {
      const { signature, ...manifest } = JSON.parse(manifestRow.manifest)
      const expected = createHmac('sha256', derive('manifest')).update(JSON.stringify(manifest)).digest()
      if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), expected)) throw new Error()
      if (typeof manifest.keyId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.keyId)) throw new Error()
      next.keyId = manifest.keyId
    }
    const secrets = await db.query<{ secret: string }>("SELECT secret FROM backup_control.targets WHERE secret<>''")
    const runtime = await first<{ value: string }>(db, "SELECT value FROM backup_control.settings WHERE key='runtime'")
    const rehearsal = runtime ? JSON.parse(runtime.value).rehearsalSecret : ''
    for (const secret of [...secrets.rows.map((row) => row.secret), ...(rehearsal ? [rehearsal] : [])]) {
      const [iv, tag, encrypted] = secret.split('.')
      const decipher = createDecipheriv('aes-256-gcm', derive('credentials'), Buffer.from(iv, 'base64'))
      decipher.setAAD(Buffer.from('backup-target-v1'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      decipher.update(Buffer.from(encrypted, 'base64'))
      decipher.final()
    }
  } catch {
    throw new BackupError('KEY_RECOVERY_REQUIRED', '已有备份或凭据与该密钥不匹配，请导入原主密钥，不能重新生成替代', 409)
  }
}

const patterns = { dump: /^pg_dump \(PostgreSQL\) /, restore: /^pg_restore \(PostgreSQL\) /, psql: /^psql \(PostgreSQL\) /, transfer: /^rclone v/ }
async function inspectTool(name: ToolName, file: DeploymentFile): Promise<BackupToolStatus> {
  const configuredPath = file.tools[name] || ''
  const environment = process.env[toolDefaults[name][0]] || ''
  const effectivePath = configuredPath || environment || toolDefaults[name][1]
  const status: BackupToolStatus = {
    configuredPath,
    effectivePath,
    source: configuredPath ? 'local' : environment ? 'environment' : 'automatic',
    ready: false,
    version: '',
    error: '',
  }
  try {
    const output = await command(effectivePath, ['--version'], { timeout: 5000, captureLimit: 4096, failOnOverflow: true })
    if (!patterns[name].test(output.trim())) throw new Error()
    status.ready = true
    // Only expose the known version token; custom executables must not echo secrets into the API.
    status.version = output.match(name === 'transfer' ? /^rclone (v[\d.]+)/ : /\(PostgreSQL\) ([\d.]+)/)?.[1] || ''
  } catch {
    status.error = '未检测到匹配的工具，请检查是否安装、路径和执行权限'
  }
  return status
}
export async function deploymentView(file = readDeploymentFile()): Promise<BackupDeployment> {
  const results = await Promise.all(toolNames.map(async (name) => [name, await inspectTool(name, file)] as const))
  return {
    revision: file.revision,
    keyConfigured: Boolean(file.masterKey) || encryptionReady(),
    keySource: file.masterKey ? 'local' : process.env.BACKUP_ENCRYPTION_KEY ? 'environment' : 'missing',
    keyId: file.keyId || keyId(),
    configFile: deploymentFilePath(),
    tools: Object.fromEntries(results) as BackupDeployment['tools'],
  }
}
export async function configureDeployment(db: Db, input: BackupDeploymentInput, detectOnly = false) {
  const client = await db.connect()
  const query = client.query.bind(client)
  let locked = false
  try {
    const lock = await query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [BACKUP_LOCK])
    if (!lock.rows[0]?.locked) throw new BackupError('BACKUP_BUSY', '备份任务正在执行，请稍后配置', 409)
    locked = true
    if ((await first<{ value: string }>({ query }, "SELECT value FROM backup_control.settings WHERE key='maintenance'"))?.value === 'true')
      throw new BackupError('MAINTENANCE', '恢复中不能修改运行环境', 409)
    const next = prepareDeploymentFile(input)
    await verifyRecoveredKey({ query }, next)
    const view = await deploymentView(next)
    if (detectOnly) return { deployment: { ...view, revision: input.revision } }
    for (const name of toolNames)
      if (next.tools[name] && !view.tools[name].ready) throw new BackupError('TOOL_UNAVAILABLE', `${toolDefaults[name][1]} 路径检测失败，未保存配置`)
    const current = readDeploymentFile()
    if (current.revision !== input.revision) throw new BackupError('REVISION_CONFLICT', '本地配置已更新，请重新加载', 409)
    // Persist after all validation. No database configuration or credentials are written here.
    writeDeploymentFile(next)
    return {
      deployment: { ...view, keyConfigured: next.masterKey ? true : view.keyConfigured, keySource: next.masterKey ? ('local' as const) : view.keySource },
    }
  } finally {
    if (locked) await query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => {})
    client.release()
  }
}
