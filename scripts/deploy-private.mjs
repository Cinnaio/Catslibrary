// 在独立 Linux 主机构建双仓库快照，通过协议 3 发布；不调用 Actions。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sshOptions = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes']
const shaPattern = /^[0-9a-f]{40}$/
export const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'"

export function parseArgs(args) {
  const options = { 'build-host': 'catr', 'deploy-host': 'story', 'private-repo': resolve(root, '../Catslibrary-private-sources'), 'core-ref': 'HEAD', 'postgres-image': 'postgres:18-alpine' }
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '')
    if (args[i] === '--build-only') { options.buildOnly = true; continue }
    if (args[i] === '--help') { options.help = true; continue }
    if (!args[i].startsWith('--') || !['build-host', 'deploy-host', 'private-repo', 'core-ref', 'adapter-ref', 'node-bin', 'postgres-image'].includes(key) || !args[i + 1]) throw new Error(`未知参数或缺少值: ${args[i]}`)
    options[key] = args[++i]
  }
  for (const key of ['build-host', 'deploy-host']) if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(options[key])) throw new Error(`${key} 必须是 SSH 主机别名`)
  if (options['build-host'] === options['deploy-host']) throw new Error('请使用独立构建机，不能在生产机执行构建')
  return options
}

export function selectAdapterRef(options, state) {
  for (const key of ['releaseSha', 'sourceAdapterRevision']) if (state[key] !== null && !shaPattern.test(state[key] || '')) throw new Error(`线上状态缺少有效 ${key}`)
  return options['adapter-ref'] || state.sourceAdapterRevision || 'HEAD'
}

function run(command, args, { cwd = root, capture = false, input } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'] })
    let output = ''
    if (capture) child.stdout.on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolveRun(output.trim()) : reject(new Error(`${command} 执行失败 (${code})`)))
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input) }
  })
}
const ssh = (host, command, options) => run('ssh', [...sshOptions, host, command], options)
async function revision(repo, ref) {
  const sha = await run('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: repo, capture: true })
  if (!shaPattern.test(sha)) throw new Error('Git 未返回完整提交 SHA')
  return sha
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('npm run deploy:private -- [--core-ref HEAD] [--adapter-ref HEAD或SHA] [--build-host catr] [--deploy-host story] [--private-repo 路径] [--node-bin Linux的Node目录] [--postgres-image postgres:18-alpine] [--build-only]')
    return
  }
  const buildHost = options['build-host'], deployHost = options['deploy-host']
  const protocol = await ssh(deployHost, 'sudo -n /usr/local/bin/zhizhou-release --protocol-version', { capture: true })
  if (protocol !== '3') throw new Error('请先按部署文档安装协议 3 发布工具')
  const initial = JSON.parse(await ssh(deployHost, 'sudo -n /usr/local/bin/zhizhou-release --deployment-state', { capture: true }))
  const coreSha = await revision(root, options['core-ref'])
  const privateRepo = resolve(options['private-repo'])
  const adapterSha = await revision(privateRepo, selectAdapterRef(options, initial))
  // 拒绝意外回退核心；找不到线上提交时应先 fetch，不猜测祖先关系。
  if (initial.releaseSha) await run('git', ['merge-base', '--is-ancestor', initial.releaseSha, coreSha])
  const pinnedNode = (await run('git', ['show', `${coreSha}:.node-version`], { capture: true })).trim()
  if (!/^\d+\.\d+\.\d+$/.test(pinnedNode)) throw new Error('无效的固定 Node 版本')
  const nodeBin = options['node-bin'] || `/opt/node-v${pinnedNode}-linux-x64/bin`
  await mkdir(join(root, '.tmp'), { recursive: true })
  const local = await mkdtemp(join(root, '.tmp/private-deploy-'))
  console.log(`发布快照 core=${coreSha} adapters=${adapterSha}；只包含已提交源码。记录目录: ${local}`)
  await writeFile(join(local, 'plan.json'), JSON.stringify({ coreSha, adapterSha, initial, buildHost, deployHost, buildOnly: Boolean(options.buildOnly) }, null, 2) + '\n')
  await run('git', ['archive', '--format=tar', `--output=${join(local, 'core.tar')}`, coreSha])
  await run('git', ['archive', '--format=tar', `--output=${join(local, 'private.tar')}`, adapterSha], { cwd: privateRepo })
  const job = await ssh(buildHost, 'umask 077; mktemp -d "$HOME/catslibrary-release.XXXXXXXX"', { capture: true })
  if (!/^\/[a-zA-Z0-9/_.-]+\/catslibrary-release\.[a-zA-Z0-9]+$/.test(job)) throw new Error('构建机返回了异常临时目录')
  console.log(`独立 Linux 构建目录: ${buildHost}:${job}`)
  await run('scp', [...sshOptions, join(local, 'core.tar'), join(local, 'private.tar'), `${buildHost}:${job}/`])
  await ssh(buildHost, `bash -s -- ${[job, coreSha, adapterSha, nodeBin, options['postgres-image']].map(quote).join(' ')}`, { input: await readFile(join(root, 'scripts/build-private-release.sh')) })
  for (const name of ['release.tgz', 'release-manifest.json']) await run('scp', [...sshOptions, `${buildHost}:${job}/${name}`, join(local, name)])
  const digest = createHash('sha256').update(await readFile(join(local, 'release.tgz'))).digest('hex')
  const remoteDigest = (await ssh(buildHost, `sha256sum ${quote(job + '/release.tgz')}`, { capture: true })).split(/\s/)[0]
  if (digest !== remoteDigest) throw new Error('下载归档与已验收归档摘要不一致')
  const manifest = JSON.parse(await readFile(join(local, 'release-manifest.json'), 'utf8'))
  if (manifest.releaseSha !== coreSha || manifest.sourceAdapterRevision !== adapterSha || manifest.nodeVersion !== pinnedNode || manifest.platform !== 'linux') throw new Error('已验收清单与选定版本不匹配')
  await writeFile(join(local, 'release.tgz.sha256'), `${digest}  release.tgz\n`)
  await writeFile(join(local, 'result.json'), JSON.stringify({ buildVerified: true, deployed: false, coreSha, adapterSha, archiveSha256: digest }, null, 2) + '\n')
  // 只清理本次 mktemp 返回且已校验的 Linux 临时目录；本地保留归档和记录。
  await ssh(buildHost, `rm -rf -- ${quote(job)}`)
  if (options.buildOnly) { console.log(`合并发布包已验证，尚未部署: ${local}`); return }
  // 上传时使用唯一暂存文件，完整传完后才原子改名；发布锁内再次核对摘要与线上版本。
  const remoteUpload = `/tmp/release-${coreSha}-${digest}.upload`
  await run('scp', [...sshOptions, join(local, 'release.tgz'), `${deployHost}:${remoteUpload}`])
  const archive = `/tmp/release-${coreSha}.tgz`
  const command = `mv -- ${quote(remoteUpload)} ${quote(archive)} && sudo -n /usr/local/bin/zhizhou-release ${quote(coreSha)} --expect-current ${quote(initial.releaseSha || 'none')} ${quote(initial.sourceAdapterRevision || 'none')} --archive-sha256 ${quote(digest)}`
  await ssh(deployHost, command)
  const current = JSON.parse(await ssh(deployHost, 'sudo -n /usr/local/bin/zhizhou-release --deployment-state', { capture: true }))
  if (current.releaseSha !== coreSha || current.sourceAdapterRevision !== adapterSha) throw new Error('发布后的线上版本与目标不一致，请检查是否有并发发布')
  await writeFile(join(local, 'result.json'), JSON.stringify({ buildVerified: true, deployed: true, coreSha, adapterSha, archiveSha256: digest, current }, null, 2) + '\n')
  console.log(`合并部署完成 core=${coreSha} adapters=${adapterSha}；记录: ${local}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
