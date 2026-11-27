// Public Actions entry point. Never forward private child output to the public log.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, openSync, closeSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const shaPattern = /^[0-9a-f]{40}$/
export const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'"
export function requireSha(value) {
  assert.match(value || '', shaPattern, '无效的完整提交 SHA')
  return value
}
export function readState(text) {
  const state = JSON.parse(text)
  assert.ok(state && !Array.isArray(state) && typeof state === 'object')
  for (const key of ['releaseSha', 'sourceAdapterRevision']) if (state[key] !== null) requireSha(state[key])
  return { releaseSha: state.releaseSha, sourceAdapterRevision: state.sourceAdapterRevision }
}
export function assertCurrent(actual, expected) {
  // Do not format either state in errors: adapter revisions belong to the private repository.
  if (actual.releaseSha !== expected.releaseSha || actual.sourceAdapterRevision !== expected.sourceAdapterRevision) {
    throw new Error('线上版本已变化，请重新运行整个工作流')
  }
}
export function selectAdapterRef(requested, state) {
  return requested?.trim() || state.sourceAdapterRevision || 'main'
}
export function resolveAdapterRef(ref, refs) {
  if (shaPattern.test(ref)) return ref
  const branch = ref.replace(/^refs\/heads\//, '')
  const candidates = ref.startsWith('refs/')
    ? [ref, 'refs/remotes/origin/' + branch]
    : ['refs/remotes/origin/' + ref, 'refs/tags/' + ref]
  const match = candidates.find(candidate => refs.includes(candidate))
  if (!match) throw new Error('找不到指定私有版本')
  return match
}
export function childEnvironment(env) {
  // No secrets or Actions file-command channels reach npm, tests, build scripts or SSH.
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'RUNNER_TEMP']
  return { ...Object.fromEntries(allowed.filter(key => env[key]).map(key => [key, env[key]])), CI: 'true', NO_COLOR: '1' }
}
export async function runPrivate(command, args, { cwd, env = childEnvironment(process.env), log, capture = false, label = '私有步骤' } = {}) {
  const fd = log ? openSync(log, 'a', 0o600) : null
  try {
    return await new Promise((resolveRun, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: ['ignore', capture ? 'pipe' : (fd ?? 'ignore'), fd ?? 'ignore'] })
      let output = '', tooLarge = false
      if (capture) child.stdout.on('data', chunk => {
        if (output.length + chunk.length > 65536) { tooLarge = true; child.kill(); return }
        output += chunk
      })
      child.once('error', () => reject(new Error(label + ' 无法启动')))
      child.once('close', code => code === 0 && !tooLarge ? resolveRun(output.trim()) : reject(new Error(label + ' 失败；原始输出未公开')))
    })
  } finally { if (fd !== null) closeSync(fd) }
}
export function workDirectory(env) {
  if (!env.RUNNER_TEMP) throw new Error('缺少 runner 临时目录')
  return join(resolve(env.RUNNER_TEMP), 'catslibrary-private-deploy')
}
async function summary(env, text) {
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, text + '\n')
}
export function validateConnection(env, prefix = 'DEPLOY') {
  for (const suffix of ['SSH_KEY', 'KNOWN_HOSTS']) if (!env[prefix + '_' + suffix]?.trim()) throw new Error('缺少 SSH Secret')
  if (prefix === 'DEPLOY') {
    assert.match(env.DEPLOY_HOST || '', /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/)
    assert.match(env.DEPLOY_USER || '', /^[a-zA-Z_][a-zA-Z0-9_-]*$/)
  }
}
async function withSsh(env, prefix, callback) {
  validateConnection(env, prefix)
  const directory = await mkdtemp(join(workDirectory(env), 'ssh-'))
  const host = prefix === 'DEPLOY' ? env.DEPLOY_HOST : 'github.com'
  const user = prefix === 'DEPLOY' ? env.DEPLOY_USER : 'git'
  const log = join(workDirectory(env), 'private.log')
  try {
    const key = join(directory, 'key'), known = join(directory, 'known_hosts')
    await writeFile(key, env[prefix + '_SSH_KEY'].trim() + '\n', { mode: 0o600 })
    await writeFile(known, env[prefix + '_KNOWN_HOSTS'].trim() + '\n', { mode: 0o600 })
    await runPrivate('ssh-keygen', ['-F', host, '-f', known], { log, label: '已固定主机密钥检查' })
    const options = ['-F', '/dev/null', '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UserKnownHostsFile=' + known, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
    const ssh = command => runPrivate('ssh', [...options, user + '@' + host, command], { capture: true, log, label: '生产连接或发布检查' })
    if (prefix === 'DEPLOY' && await ssh('sudo -n /usr/local/bin/zhizhou-release --protocol-version') !== '3') throw new Error('服务器发布协议必须为 3')
    return await callback({ ssh, options, upload: (local, remote) => runPrivate('scp', [...options, local, user + '@' + host + ':' + remote], { log, label: '上传发布包' }) })
  } finally { await rm(directory, { recursive: true, force: true }) }
}
async function prepare(env) {
  const directory = workDirectory(env), core = resolve(env.CORE_DIRECTORY || 'core')
  await mkdir(directory, { mode: 0o700 }) // A rerun must start with a fresh directory/plan.
  const log = join(directory, 'private.log')
  const git = (args, cwd = core, extra = {}) => runPrivate('git', args, { cwd, capture: true, log, label: '解析源码版本', ...extra })
  const coreSha = requireSha(await git(['rev-parse', 'HEAD']))
  const initial = await withSsh(env, 'DEPLOY', async ({ ssh }) => readState(await ssh('sudo -n /usr/local/bin/zhizhou-release --deployment-state')))
  if (initial.releaseSha) await git(['merge-base', '--is-ancestor', initial.releaseSha, coreSha])
  assert.match(env.PRIVATE_SOURCES_REPOSITORY || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  const adapterRepo = join(directory, 'adapters')
  await mkdir(adapterRepo)
  const adapterSha = await withSsh(env, 'PRIVATE_SOURCES', async ({ options }) => {
    const gitEnv = { ...childEnvironment(env), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: ['ssh', ...options].map(quote).join(' ') }
    const privateGit = args => git(args, adapterRepo, { env: gitEnv })
    await privateGit(['init', '--quiet'])
    await privateGit(['remote', 'add', 'origin', 'git@github.com:' + env.PRIVATE_SOURCES_REPOSITORY + '.git'])
    await privateGit(['fetch', '--quiet', '--no-recurse-submodules', 'origin', '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*'])
    const refs = (await privateGit(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin', 'refs/tags'])).split('\n')
    const selected = resolveAdapterRef(selectAdapterRef(env.ADAPTER_REF, initial), refs)
    const revision = requireSha(await privateGit(['rev-parse', '--verify', '--end-of-options', selected + '^{commit}']))
    await privateGit(['archive', '--format=tar', '--output=' + join(directory, 'private.tar'), revision])
    return revision
  })
  await rm(adapterRepo, { recursive: true, force: true })
  await git(['archive', '--format=tar', '--output=' + join(directory, 'core.tar'), coreSha])
  const source = join(directory, 'core')
  await mkdir(source)
  await runPrivate('tar', ['-xf', join(directory, 'core.tar'), '-C', source], { log })
  await mkdir(join(source, 'api/private-sources'), { recursive: true })
  await runPrivate('tar', ['-xf', join(directory, 'private.tar'), '-C', join(source, 'api/private-sources')], { log })
  await writeFile(join(directory, 'plan.json'), JSON.stringify({ coreSha, adapterSha, initial }), { mode: 0o600 })
  await summary(env, '## 已固定合并构建版本\n\n- 核心：' + coreSha + '\n- 私有书源：' + (env.ADAPTER_REF?.trim() ? '使用显式指定版本' : initial.sourceAdapterRevision ? '保留线上版本' : '首次部署使用 main') + '\n- 构建与临时数据库验收在 GitHub 执行；story 只接收完整包。\n- 私有版本、源码、完整日志与发布归档不上传到公开工件。')
}
async function loadPlan(env) {
  const directory = workDirectory(env)
  const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8'))
  requireSha(plan.coreSha); requireSha(plan.adapterSha)
  readState(JSON.stringify(plan.initial))
  return { directory, plan, source: join(directory, 'core') }
}
// Keep at most two check tasks active, and drain them before rejecting so cleanup
// cannot race a still-running private check. Stop scheduling after a failure.
export async function runBoundedChecks(checks, concurrency = 2) {
  assert.ok(Number.isInteger(concurrency) && concurrency > 0)
  let next = 0
  const failures = []
  const worker = async () => {
    while (failures.length === 0 && next < checks.length) {
      const check = checks[next++]
      try { await check() } catch (error) { failures.push(error) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, checks.length) }, worker))
  if (failures.length) throw new AggregateError(failures, '发布校验失败；原始输出未公开')
}
export async function verifyBuild(run) {
  await runBoundedChecks([
    () => run('核心 Lint', 'npm', ['run', 'lint', '--', '--quiet', '--ignore-pattern', 'api/private-sources/**']),
    () => run('核心类型检查', 'npm', ['run', 'typecheck']),
    // Both Vitest invocations share a workspace/cache; keep them in one lane.
    async () => {
      await run('API 关键回归', 'npm', ['run', 'test', '--workspace=@zhi-zhou/api', '--', 'src/services/readiness.test.ts', 'src/routes/auth.test.ts', 'src/routes/account-security.test.ts', 'src/routes/browser-security.test.ts', 'src/services/scraper/fetch.test.ts', 'src/services/outbound-fetch.test.ts', 'src/routes/web.test.ts', 'src/routes/ai-agent.test.ts', '--maxWorkers=2', '--minWorkers=1'])
      await run('适配器回归', 'npm', ['run', 'test', '--workspace=@zhi-zhou/api', '--', '--config', 'private-sources/vitest.config.ts', 'private-sources/tests', '--maxWorkers=2', '--minWorkers=1'])
    },
    () => run('Agent 评估类型检查', 'npm', ['run', 'eval:agent:check']),
    () => run('适配器类型检查', 'node', ['node_modules/typescript/bin/tsc', '-p', 'api/private-sources/tsconfig.json', '--noEmit']),
    () => run('发布失败恢复回归', 'python3', ['scripts/test-release.py']),
    () => run('私有部署策略回归', 'node', ['--test', 'scripts/test-private-deploy.mjs']),
  ])
}
async function buildPhase(env, phase) {
  const { directory, plan, source } = await loadPlan(env)
  const buildEnv = { ...childEnvironment(env), RELEASE_SHA: plan.coreSha, CATSLIBRARY_SOURCE_ADAPTER_SHA: plan.adapterSha, CATSLIBRARY_PRIVATE_SOURCES: '1', npm_config_cache: join(directory, 'npm-cache') }
  const run = async (label, command, args, extra = {}) => {
    const started = performance.now()
    console.log(label)
    try {
      return await runPrivate(command, args, { cwd: source, env: buildEnv, log: join(directory, 'private.log'), label, ...extra })
    } finally {
      // Labels are trusted constants; never include private output or arguments.
      console.log(`${label} 耗时：${((performance.now() - started) / 1000).toFixed(1)} 秒`)
    }
  }
  const pinnedNode = (await readFile(join(source, '.node-version'), 'utf8')).trim()
  assert.equal(process.versions.node, pinnedNode)
  if (phase === 'install') return run('安装构建依赖', 'npm', ['ci', '--no-audit', '--no-fund'])
  if (phase === 'verify') return verifyBuild(run)
  await run('合并构建 Web 与 API', 'npm', ['run', 'build'])
  await run('打包 Linux 生产依赖与 Node', 'npm', ['run', 'release:package', '--', '--output', join(directory, 'package')])
  await run('生成完整发布归档', 'tar', ['-czf', join(directory, 'release.tgz'), '-C', join(directory, 'package'), 'web/dist', 'api/dist'])
  const digest = await hashFile(join(directory, 'release.tgz'))
  const verifyCode = [
    'import json,os,pathlib,runpy,shutil,sys',
    'root=pathlib.Path(sys.argv[1]); out=root/"verified"; out.mkdir()',
    'validate=runpy.run_path("scripts/validate-release.py")["validate_archive"]',
    'm=validate(root/"release.tgz",out,os.environ["RELEASE_SHA"],pathlib.Path(".node-version").read_text().strip())',
    'assert m["sourceAdapterRevision"] == os.environ["CATSLIBRARY_SOURCE_ADAPTER_SHA"]',
    'shutil.copyfile(out/"api/dist/release.json",root/"release-manifest.json")'
  ].join('\n')
  await run('重新解包并验证归档清单', 'python3', ['-c', verifyCode, directory])
  await run('检查包内原生依赖', join(directory, 'verified/api/dist/runtime/node'), [join(directory, 'verified/api/dist/check-release-runtime.mjs')])
  await run('隔离 PostgreSQL 发布冒烟', 'npm', ['run', 'release:smoke', '--', join(directory, 'verified')], { env: { ...buildEnv, RELEASE_SMOKE_DATABASE_URL: 'postgres://release_smoke:release_smoke@127.0.0.1:5432/release_smoke' } })
  assert.equal(await hashFile(join(directory, 'release.tgz')), digest)
  const manifest = await verifyArtifact(directory, { core: plan.coreSha, adapter: plan.adapterSha, digest })
  await writeFile(join(directory, 'verified.json'), JSON.stringify({ digest }), { mode: 0o600 })
  for (const version of [manifest.apiVersion, manifest.webVersion, manifest.nodeVersion]) assert.match(version, /^\d+\.\d+\.\d+$/)
  await summary(env, '## 完整归档构建与验收通过\n\n- API ' + manifest.apiVersion + ' / Web ' + manifest.webVersion + ' / Node ' + manifest.nodeVersion + '\n- 归档 SHA-256：' + digest + '\n- Linux 运行时、迁移、就绪和 Web 入口检查通过。\n- 此结果仅表示构建验收完成；是否上线以生产部署步骤为准。')
}
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function verifyArtifact(directory, expected) {
  requireSha(expected.core); requireSha(expected.adapter)
  assert.match(expected.digest || '', /^[0-9a-f]{64}$/)
  assert.equal(await hashFile(join(directory, 'release.tgz')), expected.digest)
  const manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8'))
  if (manifest.releaseSha !== expected.core || manifest.sourceAdapterRevision !== expected.adapter || manifest.platform !== 'linux' || manifest.arch !== 'x64') throw new Error('发布包版本或平台不符')
  return manifest
}
export const checkProduction = `import json,re,sys,urllib.request
base='http://127.0.0.1:8080'
def get(path):
    with urllib.request.urlopen(base+path, timeout=10) as response:
        assert response.status == 200
        return response.read().decode()
ready=json.loads(get('/api/ready'))
assert ready.get('ready') is True and ready.get('release') == sys.argv[1]
get('/api/health')
html=get('/')
entry=re.search(r'/assets/index-[A-Za-z0-9_.-]+\\.js', html)
assert entry, '首页缺少入口资源'
get(entry.group(0))
get('/api/novels?limit=1')
print('production readiness, health, home, entry and catalog: OK')`

async function publish(env) {
  const { directory, plan } = await loadPlan(env)
  const { digest } = JSON.parse(await readFile(join(directory, 'verified.json'), 'utf8'))
  await verifyArtifact(directory, { core: plan.coreSha, adapter: plan.adapterSha, digest })
  assert.match(env.GITHUB_RUN_ID || '', /^\d+$/); assert.match(env.GITHUB_RUN_ATTEMPT || '', /^\d+$/)
  await withSsh(env, 'DEPLOY', async ({ ssh, upload }) => {
    assertCurrent(readState(await ssh('sudo -n /usr/local/bin/zhizhou-release --deployment-state')), plan.initial)
    const staging = '/tmp/release-' + plan.coreSha + '-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT + '.upload'
    const archive = '/tmp/release-' + plan.coreSha + '.tgz'
    await upload(join(directory, 'release.tgz'), staging)
    await ssh('mv -- ' + quote(staging) + ' ' + quote(archive) + ' && sudo -n /usr/local/bin/zhizhou-release ' + quote(plan.coreSha) + ' --expect-current ' + quote(plan.initial.releaseSha || 'none') + ' ' + quote(plan.initial.sourceAdapterRevision || 'none') + ' --archive-sha256 ' + quote(digest))
    assertCurrent(readState(await ssh('sudo -n /usr/local/bin/zhizhou-release --deployment-state')), { releaseSha: plan.coreSha, sourceAdapterRevision: plan.adapterSha })
    await ssh('python3 -c ' + quote(checkProduction) + ' ' + quote(plan.coreSha))
  })
  await summary(env, '## 生产部署通过\n\n- 核心：' + plan.coreSha + '\n- 私有书源与本次固定版本一致。\n- 就绪、健康、首页、入口资源和书目接口检查通过。\n- story 没有安装依赖或运行构建。')
}
export async function cleanup(env) {
  const directory = workDirectory(env)
  // Resolve the parent first; never recursively remove an unverified computed target.
  const parent = await realpath(resolve(env.RUNNER_TEMP))
  let target
  try { target = await realpath(directory) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (dirname(target) !== parent || target !== join(parent, 'catslibrary-private-deploy')) throw new Error('清理目录越界')
  await rm(target, { recursive: true, force: true })
}
export async function main(command, env = process.env) {
  if (command === 'cleanup') return cleanup(env)
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REPOSITORY !== 'Cinnaio/Catslibrary' || env.GITHUB_REF !== 'refs/heads/main') throw new Error('仅允许主仓库 main 手动执行')
  if (command === 'prepare') return prepare(env)
  if (['install', 'verify', 'build'].includes(command)) return buildPhase(env, command)
  if (command === 'publish') return publish(env)
  throw new Error('无效步骤')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(async () => {
    // Error messages/stack traces may contain private refs, filenames or source. Never echo them.
    console.error('步骤失败；为保护私有源码，原始诊断未写入公开日志。请按部署文档使用私有环境复现。')
    await summary(process.env, '## 本次流程未完成\n\n请按失败步骤排查；未声明构建或上线成功。原始日志不会上传到公开工件。')
    process.exitCode = 1
  })
}
