import { lookup } from 'node:dns/promises'
import { isIP, BlockList } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm, rename, lstat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Db } from '../../db/pool'
import { all } from '../../db/query'
import { first } from '../../db/query'
import { allowedHosts, backupRoot, BackupError, unseal } from './config'
import { archivePath, digestFile, versionDirectory, verifyManifest, type Manifest } from './archive'
import { command, transferTool } from './process'
import { type TargetRow, targetView } from './store'

export async function permittedAddress(host: string) {
  if (!allowedHosts().includes(host.toLowerCase())) throw new BackupError('HOST_NOT_ALLOWED', '服务器未在部署允许列表中')
  const blocked = new BlockList()
  blocked.addSubnet('127.0.0.0', 8)
  blocked.addSubnet('169.254.0.0', 16)
  blocked.addSubnet('0.0.0.0', 8)
  blocked.addAddress('::1', 'ipv6')
  blocked.addAddress('::', 'ipv6')
  blocked.addSubnet('fe80::', 10, 'ipv6')
  const results = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true })
  if (!results.length || results.some((result) => blocked.check(result.address, result.family === 6 ? 'ipv6' : 'ipv4') || /^::ffff:/i.test(result.address)))
    throw new BackupError('HOST_NOT_ALLOWED', '拒绝连接回环、链路本地或元数据地址')
  return results[0]!.address
}
async function withRemote<T>(row: TargetRow, work: (run: (args: string[]) => Promise<string>, remote: string) => Promise<T>) {
  const target = targetView(row)
  if (target.type !== 'sftp') throw new BackupError('UNSUPPORTED_TARGET', '当前版本支持 SFTP，云盘适配器将在后续接入')
  const host = await permittedAddress(target.host),
    credential = unseal<{ password: string; privateKey: string }>(row.secret)
  await mkdir(path.join(backupRoot(), 'work'), { recursive: true, mode: 0o700 })
  const dir = await mkdtemp(path.join(backupRoot(), 'work', 'remote-'))
  try {
    const configFile = path.join(dir, 'rclone.conf'),
      privateFile = path.join(dir, 'identity'),
      hostsFile = path.join(dir, 'known_hosts')
    if (credential.privateKey) await writeFile(privateFile, credential.privateKey, { mode: 0o600 })
    const hostPattern = target.port === 22 ? host : `[${host}]:${target.port}`
    await writeFile(hostsFile, `${hostPattern} ${target.hostKey}\n`, { mode: 0o600 })
    const obscured = credential.password ? (await command(transferTool(), ['obscure', '-'], { input: credential.password, timeout: 10000 })).trim() : ''
    const config = [
      '[backup]',
      'type = sftp',
      `host = ${host}`,
      `port = ${target.port}`,
      `user = ${target.username}`,
      `known_hosts_file = ${hostsFile}`,
      'shell_type = none',
      'disable_hashcheck = true',
      ...(credential.privateKey ? [`key_file = ${privateFile}`] : [`pass = ${obscured}`]),
    ].join('\n')
    await writeFile(configFile, config, { mode: 0o600 })
    const run = (args: string[]) =>
      command(transferTool(), ['--config', configFile, '--retries', '1', '--low-level-retries', '1', '--contimeout', '15s', '--timeout', '5m', ...args])
    return await work(run, `backup:${target.path.replace(/\/$/, '')}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
export async function testRemote(row: TargetRow) {
  return withRemote(row, async (run, remote) => {
    const dir = await mkdtemp(path.join(backupRoot(), 'work', 'test-')),
      file = path.join(dir, 'probe'),
      retrieved = path.join(dir, 'retrieved')
    const object = `${remote}/.zhi-zhou-test-${randomUUID()}`
    try {
      await writeFile(file, randomUUID(), { mode: 0o600 })
      await run(['copyto', file, object])
      await run(['copyto', object, retrieved])
      if ((await digestFile(file)) !== (await digestFile(retrieved))) throw new BackupError('TARGET_VERIFY_FAILED', '远程读取校验失败')
    } finally {
      try {
        await run(['deletefile', object])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })
}
export async function uploadRemote(row: TargetRow, manifest: Manifest) {
  return withRemote(row, async (run, remote) => {
    const prefix = `${remote}/${manifest.siteId}/${manifest.id}`,
      check = path.join(versionDirectory(manifest.id), `verify-${randomUUID()}.tmp`)
    try {
      // 不覆盖完整副本；存在完成标记时仍读取密文做完整摘要核验。
      let exists = false,
        saved: { digest: string; signature: string } | null = null
      try {
        saved = JSON.parse(await run(['cat', `${prefix}/complete.json`]))
      } catch {
        /* 尚无完成标记 */
      }
      if (saved) {
        if (saved.digest !== manifest.digest || saved.signature !== manifest.signature)
          throw new BackupError('TARGET_CONFLICT', '远程已存在内容不同的完整版本，拒绝覆盖')
        exists = true
      }
      if (!exists) {
        await run(['copyto', archivePath(manifest.id), `${prefix}/archive.zzbackup`])
        await run(['copyto', path.join(versionDirectory(manifest.id), 'manifest.json'), `${prefix}/manifest.json`])
      }
      await run(['copyto', `${prefix}/archive.zzbackup`, check])
      if ((await digestFile(check)) !== manifest.digest) throw new BackupError('TARGET_VERIFY_FAILED', '远程副本摘要不一致')
      await run(['copyto', path.join(versionDirectory(manifest.id), 'complete.json'), `${prefix}/complete.json`])
    } finally {
      await rm(check, { force: true })
    }
  })
}
export async function ensureLocalArchive(db: Db, id: string, manifest: Manifest) {
  verifyManifest(manifest)
  try {
    const info = await lstat(archivePath(id))
    if (info.isFile() && !info.isSymbolicLink() && (await digestFile(archivePath(id))) === manifest.digest) return
  } catch {
    /* 从已完成远程副本取回 */
  }
  const copies = await all<{ target_config: string }>(
    db,
    "SELECT target_config FROM backup_control.copies WHERE version_id=$1 AND target_id!='local' AND state='available'",
    [id],
  )
  for (const copy of copies) {
    try {
      await mkdir(versionDirectory(id), { recursive: true, mode: 0o700 })
      let target: TargetRow = JSON.parse(copy.target_config)
      const current = await first<TargetRow>(db, 'SELECT * FROM backup_control.targets WHERE id=$1 AND archived=FALSE', [target.id])
      if (current) {
        const old = targetView(target),
          next = targetView(current)
        if (['type', 'host', 'port', 'path', 'username'].every((key) => old[key as keyof typeof old] === next[key as keyof typeof next])) target = current
      }
      await withRemote(target, async (run, remote) => {
        const prefix = `${remote}/${manifest.siteId}/${id}`,
          file = path.join(versionDirectory(id), 'download.tmp')
        try {
          const marker = JSON.parse(await run(['cat', `${prefix}/complete.json`]))
          if (marker.digest !== manifest.digest || marker.signature !== manifest.signature) throw new BackupError('ARCHIVE_CORRUPT', '远程完成标记不匹配')
          await run(['copyto', `${prefix}/archive.zzbackup`, file])
          if ((await digestFile(file)) !== manifest.digest) throw new BackupError('ARCHIVE_CORRUPT', '远程文件损坏')
          await rename(file, archivePath(id))
        } finally {
          await rm(file, { force: true })
        }
      })
      await writeFile(path.join(versionDirectory(id), 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
      await writeFile(path.join(versionDirectory(id), 'complete.json'), JSON.stringify({ digest: manifest.digest, signature: manifest.signature }), {
        mode: 0o600,
      })
      await db.query("UPDATE backup_control.copies SET state='available',verified_at=$2,error='' WHERE version_id=$1 AND target_id='local'", [id, Date.now()])
      return
    } catch {
      /* 尝试下一个完整副本，日志不包含凭据 */
    }
  }
  throw new BackupError('ARCHIVE_UNAVAILABLE', '没有可读取且通过校验的本地或远程副本')
}
export async function deleteRemote(row: TargetRow, manifest: Manifest) {
  return withRemote(row, async (run, remote) => {
    // rclone delete 按明确文件删除；不递归 purge 用户目录。
    for (const file of ['complete.json', 'manifest.json', 'archive.zzbackup'])
      await run(['delete', `${remote}/${manifest.siteId}/${manifest.id}`, '--include', file])
  })
}
