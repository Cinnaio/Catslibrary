import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, statfs, open } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Db } from '../../db/pool'
import { all, first } from '../../db/query'
import { readRuntimeConfig } from '../../runtime-config'
import { PROJECT_ROOT } from '../../config'
import { backupRoot, purposeKey, keyId, BackupError } from './config'
import { command, dumpTool, pgEnvironment } from './process'

export interface Manifest {
  formatVersion: 1
  id: string
  keyId: string
  siteId: string
  appVersion: string
  migrationVersion: number
  postgresVersion: number
  snapshotAt: number
  size: number
  digest: string
  iv: string
  tag: string
  runtime: Record<string, string>
  requirements: string[]
  signature: string
}
export function versionDirectory(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new BackupError('INVALID_VERSION', '版本标识无效')
  return path.join(backupRoot(), 'versions', id)
}
export const archivePath = (id: string) => path.join(versionDirectory(id), 'archive.zzbackup')
export async function digestFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
function signature(manifest: Omit<Manifest, 'signature'>) {
  return createHmac('sha256', purposeKey('manifest')).update(JSON.stringify(manifest)).digest('hex')
}
export function verifyManifest(manifest: Manifest) {
  const { signature: saved, ...payload } = manifest
  const wanted = signature(payload)
  if (
    manifest.formatVersion !== 1 ||
    manifest.keyId !== keyId() ||
    !/^[a-f0-9]{64}$/.test(saved || '') ||
    !timingSafeEqual(Buffer.from(saved, 'hex'), Buffer.from(wanted, 'hex'))
  )
    throw new BackupError('ARCHIVE_UNTRUSTED', '归档签名或密钥标识不匹配，拒绝恢复')
}
export async function durableJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temp, file)
  const dir = await open(path.dirname(file), 'r')
  try {
    await dir.sync()
  } finally {
    await dir.close()
  }
}
export async function readManifest(id: string) {
  return JSON.parse(await readFile(path.join(versionDirectory(id), 'manifest.json'), 'utf8')) as Manifest
}
export async function generateArchive(db: Db, id: string, siteId: string): Promise<Manifest> {
  purposeKey(`archive:${id}`) // 导出前确认密钥可用，避免缺少密钥时生成明文快照。
  const directory = versionDirectory(id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const plain = path.join(directory, 'database.tmp'),
    encrypted = path.join(directory, 'archive.tmp')
  const migration = await first<{ version: number }>(db, 'SELECT COALESCE(MAX(version),0)::int AS version FROM schema_migrations')
  const server = await first<{ version: string }>(db, "SELECT current_setting('server_version_num') AS version")
  const snapshotAt = Date.now()
  try {
    const available = await statfs(directory),
      database = await first<{ size: string }>(db, 'SELECT pg_database_size(current_database())::text AS size')
    if (available.bavail * available.bsize < Number(database?.size || 0) * 2 + 64 * 1024 * 1024)
      throw new BackupError('SPACE_LOW', '本地可用空间不足以生成数据库快照和加密归档')
    const handle = await open(plain, 'wx', 0o600)
    await handle.close()
    await command(dumpTool(), ['--format=custom', '--schema=public', '--no-owner', '--no-acl', '--file', plain], { env: pgEnvironment() })
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', purposeKey(`archive:${id}`), iv)
    cipher.setAAD(Buffer.from(id))
    await pipeline(createReadStream(plain), cipher, createWriteStream(encrypted, { mode: 0o600 }))
    const file = await open(encrypted, 'r')
    try {
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(encrypted, archivePath(id))
    // 服务地址可能携带供应商认证查询参数，不放入可下载的明文清单。
    const runtime = Object.fromEntries(Object.entries(readRuntimeConfig()).filter(([key]) => ['AI_TEXT_MODEL', 'AI_IMAGE_MODEL'].includes(key))) as Record<
      string,
      string
    >
    const payload: Omit<Manifest, 'signature'> = {
      formatVersion: 1,
      id,
      keyId: keyId(),
      siteId,
      appVersion: String(JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version),
      migrationVersion: Number(migration?.version || 0),
      postgresVersion: Number(server?.version || 0),
      snapshotAt,
      size: (await stat(archivePath(id))).size,
      digest: await digestFile(archivePath(id)),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      runtime,
      requirements: [
        'DATABASE_URL',
        'BACKUP_ENCRYPTION_KEY',
        'SITE_SETTINGS_ENCRYPTION_KEY',
        'SOURCE_ACCOUNT_ENCRYPTION_KEY',
        'SESSION_HASH_SALT',
        'THOUGHT_HASH_SALT',
      ],
    }
    const manifest = { ...payload, signature: signature(payload) }
    await durableJson(path.join(directory, 'manifest.json'), manifest)
    await durableJson(path.join(directory, 'complete.json'), { digest: manifest.digest, signature: manifest.signature })
    return manifest
  } finally {
    await rm(plain, { force: true })
    await rm(encrypted, { force: true })
  }
}
export async function decryptArchive(id: string, destination: string, manifest: Manifest) {
  verifyManifest(manifest)
  if (manifest.id !== id || (await digestFile(archivePath(id))) !== manifest.digest) throw new BackupError('ARCHIVE_CORRUPT', '归档摘要不匹配')
  const decipher = createDecipheriv('aes-256-gcm', purposeKey(`archive:${id}`), Buffer.from(manifest.iv, 'base64'))
  decipher.setAAD(Buffer.from(id))
  decipher.setAuthTag(Buffer.from(manifest.tag, 'base64'))
  try {
    await pipeline(createReadStream(archivePath(id)), decipher, createWriteStream(destination, { mode: 0o600 }))
  } catch {
    await rm(destination, { force: true })
    throw new BackupError('ARCHIVE_CORRUPT', '归档无法通过认证解密')
  }
}
export async function currentMigration(db: Db) {
  return Number((await first<{ version: number }>(db, 'SELECT COALESCE(MAX(version),0)::int AS version FROM schema_migrations'))?.version || 0)
}
export async function databaseSummary(db: Db) {
  return all<{ username: string }>(db, "SELECT username FROM users WHERE role='admin' AND status='active'")
}
