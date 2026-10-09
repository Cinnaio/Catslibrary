import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { loadConfig } from '../../config'
import { BackupError } from './config'
import type { ChildProcess } from 'node:child_process'
import { readDeploymentFile, type ToolName } from './deployment-file'

const activeCommands = new Set<ChildProcess>()
export function stopBackupCommands() {
  for (const child of activeCommands) child.kill('SIGTERM')
}
process.once('exit', stopBackupCommands)

export function pgEnvironment(connectionString = loadConfig().databaseUrl) {
  const url = new URL(connectionString)
  return {
    ...process.env,
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGHOST: url.searchParams.get('host') || url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '10',
    ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode')! } : {}),
    ...(url.searchParams.has('options') ? { PGOPTIONS: url.searchParams.get('options')! } : {}),
  }
}
export async function command(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; output?: string; timeout?: number; input?: string; captureLimit?: number; failOnOverflow?: boolean } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, env: options.env || process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    activeCommands.add(child)
    let output = '',
      error = '',
      settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.timeout || 3600000)
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      activeCommands.delete(child)
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(output)
    }
    const written = options.output
      ? pipeline(child.stdout, createWriteStream(options.output, { mode: 0o600 })).catch((e) => {
          child.kill('SIGKILL')
          throw e
        })
      : Promise.resolve()
    // Attach rejection immediately; await it on close to avoid unhandled rejection.
    void written.catch(() => {})
    const limit = options.captureLimit || 65536
    let overflow = false
    if (!options.output)
      child.stdout.on('data', (chunk) => {
        if (output.length + String(chunk).length > limit) overflow = true
        if (output.length < limit) output += String(chunk).slice(0, limit - output.length)
      })
    child.stderr.on('data', (chunk) => {
      if (error.length < 8192) error += String(chunk).slice(0, 8192 - error.length)
    })
    child.on('error', () => finish(new BackupError('TOOL_UNAVAILABLE', `缺少可执行工具 ${executable.split('/').pop()}`)))
    child.on('close', (code) => {
      void written.then(
        () => {
          if (code === 0) finish(overflow && options.failOnOverflow ? new BackupError('OUTPUT_TOO_LARGE', '归档结构清单超过处理上限，拒绝截断恢复') : undefined)
          else {
            const auth = /authentication|permission denied|unauthorized|403|401/i.test(error)
            const identity = /knownhosts.*(mismatch|unknown)|host key/i.test(error)
            const space = /no space|disk full/i.test(error)
            finish(
              new BackupError(
                identity ? 'TARGET_IDENTITY_FAILED' : auth ? 'TARGET_AUTH_FAILED' : space ? 'SPACE_LOW' : 'COMMAND_FAILED',
                identity
                  ? '服务器公钥校验失败，拒绝连接'
                  : auth
                    ? '认证或访问权限失败，请检查账号与公钥'
                    : space
                      ? '存储空间不足'
                      : '工具执行失败，请检查版本、连接和部署权限；原始输出未写入日志',
              ),
            )
          }
        },
        () => finish(new BackupError('WRITE_FAILED', '无法写入备份文件')),
      )
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.input)
  })
}
export async function toolAvailable(executable: string) {
  try {
    await command(executable, ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}
export const toolDefaults = { dump: ['BACKUP_PG_DUMP_PATH', 'pg_dump'], restore: ['BACKUP_PG_RESTORE_PATH', 'pg_restore'], psql: ['BACKUP_PSQL_PATH', 'psql'], transfer: ['BACKUP_RCLONE_PATH', 'rclone'] } as const
export function resolvedTool(name: ToolName) {
  return readDeploymentFile().tools[name] || process.env[toolDefaults[name][0]] || toolDefaults[name][1]
}
export const dumpTool = () => resolvedTool('dump')
export const restoreTool = () => resolvedTool('restore')
export const psqlTool = () => resolvedTool('psql')
export const transferTool = () => resolvedTool('transfer')
