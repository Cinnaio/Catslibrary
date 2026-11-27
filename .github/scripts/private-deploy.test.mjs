import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCurrent, childEnvironment, cleanup, main, quote, readState, resolveAdapterRef, runBoundedChecks, runPrivate, verifyBuild, selectAdapterRef, validateConnection, verifyArtifact, workDirectory } from './private-deploy.mjs'
const core = 'a'.repeat(40), adapter = 'b'.repeat(40), newer = 'c'.repeat(40)
const state = { releaseSha: core, sourceAdapterRevision: adapter }
const here = dirname(fileURLToPath(import.meta.url))

test('保留线上适配器；显式选择与首次安装可解析远端分支和标签', () => {
  assert.equal(selectAdapterRef('', state), adapter)
  assert.equal(selectAdapterRef(' main ', state), 'main')
  assert.equal(selectAdapterRef('', { releaseSha: null, sourceAdapterRevision: null }), 'main')
  const refs = ['refs/remotes/origin/main', 'refs/remotes/origin/feature', 'refs/tags/v1']
  assert.equal(resolveAdapterRef('main', refs), refs[0])
  assert.equal(resolveAdapterRef('refs/heads/feature', refs), refs[1])
  assert.equal(resolveAdapterRef('v1', refs), refs[2])
  assert.equal(resolveAdapterRef(adapter, refs), adapter)
  assert.throws(() => resolveAdapterRef('main~1;echo bad', refs))
})
test('损坏状态与核心或私有版本并发更新都被拒绝', () => {
  assert.deepEqual(readState(JSON.stringify(state)), state)
  for (const invalid of ['null', '{}', '[]', JSON.stringify({ ...state, sourceAdapterRevision: '' })]) assert.throws(() => readState(invalid))
  assertCurrent(state, state)
  for (const actual of [{ ...state, releaseSha: newer }, { ...state, sourceAdapterRevision: newer }]) {
    assert.throws(() => assertCurrent(actual, state), error => !error.message.includes(adapter) && !error.message.includes(newer))
  }
})
test('构建进程收不到部署密钥、私有 ref 或 GitHub 文件命令通道', () => {
  const env = childEnvironment({ PATH: '/bin', HOME: '/tmp/test', DEPLOY_SSH_KEY: 'secret', PRIVATE_SOURCES_SSH_KEY: 'secret', ADAPTER_REF: 'private-branch', GITHUB_OUTPUT: 'public-output', GITHUB_STEP_SUMMARY: 'public-summary', GITHUB_ENV: 'public-env', ACTIONS_RUNTIME_TOKEN: 'secret', NODE_OPTIONS: '--require injected.cjs' })
  assert.deepEqual(env, { PATH: '/bin', HOME: '/tmp/test', CI: 'true', NO_COLOR: '1' })
})
test('子进程成功和失败都不把私有 stdout/stderr 或工作流命令转发到公开日志', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'private-log-test-'))
  try {
    const log = join(directory, 'private.log')
    const sentinel = 'PRIVATE_SOURCE_SENTINEL'
    const module = new URL('./private-deploy.mjs', import.meta.url).href
    const code = 'import {runPrivate} from ' + JSON.stringify(module) + '; try { await runPrivate(process.execPath,["-e",' + JSON.stringify('console.log("::error::' + sentinel + '"); console.error("' + sentinel + '"); process.exit(7)') + '],{log:' + JSON.stringify(log) + '}); } catch(e) { console.log(e.message); }'
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.ok(!(result.stdout + result.stderr).includes(sentinel))
    assert.ok((await readFile(log, 'utf8')).includes(sentinel))
    assert.equal(await runPrivate(process.execPath, ['-e', 'console.log("' + sentinel + '")'], { capture: true }), sentinel)
    await assert.rejects(runPrivate(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { capture: true }))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('没有通过验证的完整包不能用于上线', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'private-package-test-'))
  try {
    const bytes = 'fixture', digest = createHash('sha256').update(bytes).digest('hex')
    const manifest = { releaseSha: core, sourceAdapterRevision: adapter, platform: 'linux', arch: 'x64' }
    await writeFile(join(directory, 'release.tgz'), bytes)
    for (const change of [{}, { releaseSha: newer }, { sourceAdapterRevision: newer }, { platform: 'win32' }, { arch: 'arm64' }]) {
      await writeFile(join(directory, 'release-manifest.json'), JSON.stringify({ ...manifest, ...change }))
      if (!Object.keys(change).length) assert.deepEqual(await verifyArtifact(directory, { core, adapter, digest }), manifest)
      else await assert.rejects(verifyArtifact(directory, { core, adapter, digest }))
    }
    await writeFile(join(directory, 'release.tgz'), 'tampered')
    await assert.rejects(verifyArtifact(directory, { core, adapter, digest }))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('SSH 参数防注入且默认拒绝其他仓库和事件执行', async () => {
  const env = { DEPLOY_HOST: 'host.example', DEPLOY_USER: 'deployer', DEPLOY_SSH_KEY: 'fixture', DEPLOY_KNOWN_HOSTS: 'fixture' }
  validateConnection(env)
  for (const host of ['-oProxyCommand=bad', 'host;id', 'host\nother']) assert.throws(() => validateConnection({ ...env, DEPLOY_HOST: host }))
  assert.equal(quote("a'b $x"), "'a'\\''b $x'")
  await assert.rejects(main('prepare', { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'Cinnaio/Catslibrary', GITHUB_REF: 'refs/heads/main' }))
  await assert.rejects(main('prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'other/fork', GITHUB_REF: 'refs/heads/main' }))
  await assert.rejects(main('prepare', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Cinnaio/Catslibrary', GITHUB_REF: 'refs/heads/feature' }))
})
test('清理仅删除本次 runner 的固定私有工作目录', async () => {
  assert.throws(() => workDirectory({}))
  const directory = await mkdtemp(join(tmpdir(), 'private-cleanup-test-'))
  try {
    const env = { RUNNER_TEMP: directory }, work = workDirectory(env)
    await mkdir(work)
    await writeFile(join(directory, 'unrelated'), 'preserve')
    await writeFile(join(work, 'private.log'), 'private')
    await cleanup(env)
    await assert.rejects(access(work))
    assert.equal(await readFile(join(directory, 'unrelated'), 'utf8'), 'preserve')
    await cleanup(env)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('公开私有合并发布不上传工件或缓存；普通公开验收固定关闭私有源码', async () => {
  const workflow = await readFile(resolve(here, '../workflows/deploy.yml'), 'utf8')
  assert.ok(!/upload-artifact|download-artifact|actions\/cache|cache:\s*npm/.test(workflow))
  assert.ok(workflow.includes('if: always()'))
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"))
  const publicVerify = await readFile(resolve(here, '../workflows/release-verify.yml'), 'utf8')
  assert.ok(publicVerify.includes("CATSLIBRARY_PRIVATE_SOURCES: '0'"))
  assert.ok(publicVerify.includes('check-public-source-build.mjs'))
})

const deferred = () => {
  let resolve, reject
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}
const nextTurn = () => new Promise(resolveTurn => setImmediate(resolveTurn))

test('发布检查最多并行两项，空出位置才启动下一项且不遗漏检查', async () => {
  const gates = Array.from({ length: 5 }, deferred), started = [], completed = []
  let active = 0, peak = 0
  const pending = runBoundedChecks(gates.map((gate, index) => async () => {
    started.push(index)
    peak = Math.max(peak, ++active)
    await gate.promise
    active--
    completed.push(index)
  }))
  assert.deepEqual(started, [0, 1])
  for (const index of [0, 1, 2]) {
    gates[index].resolve()
    await nextTurn()
    assert.equal(started.length, index + 3)
  }
  gates[3].resolve()
  gates[4].resolve()
  await pending
  assert.equal(peak, 2)
  assert.equal(active, 0)
  assert.deepEqual(completed.sort(), [0, 1, 2, 3, 4])
})
test('发布检查失败后停止调度，等待在途检查退出才拒绝后续打包', async () => {
  const first = deferred(), second = deferred(), started = []
  let settled = false, failure
  const pending = runBoundedChecks([
    async () => { started.push(1); await first.promise },
    async () => { started.push(2); await second.promise },
    async () => { started.push(3) },
  ]).then(() => { settled = true }, error => { settled = true; failure = error })
  first.reject(new Error('private check failed'))
  await nextTurn()
  assert.deepEqual(started, [1, 2])
  assert.equal(settled, false)
  second.resolve()
  await pending
  assert.ok(failure instanceof AggregateError)
  assert.equal(failure.errors.length, 1)
  assert.deepEqual(started, [1, 2])
})
test('合并验收保留八项门禁，两套 Vitest 回归不会同时访问工作区', async () => {
  const calls = [], finished = new Set()
  let active = 0, peak = 0
  await verifyBuild(async (label, command, args) => {
    peak = Math.max(peak, ++active)
    calls.push({ label, command, args })
    if (label === '适配器回归') assert.ok(finished.has('API 关键回归'))
    await nextTurn()
    finished.add(label)
    active--
  })
  assert.equal(peak, 2)
  assert.equal(calls.length, 8)
  assert.deepEqual([...finished].sort(), ['核心 Lint', '核心类型检查', 'API 关键回归', '适配器回归', 'Agent 评估类型检查', '适配器类型检查', '发布失败恢复回归', '私有部署策略回归'].sort())
  for (const call of calls.filter(call => ['API 关键回归', '适配器回归'].includes(call.label))) {
    assert.ok(call.args.includes('--maxWorkers=2'))
  }
})
test('API 回归失败时不启动适配器回归，合并验收不能成功', async () => {
  const called = []
  await assert.rejects(verifyBuild(async label => {
    called.push(label)
    await nextTurn()
    if (label === 'API 关键回归') throw new Error('failed')
  }), AggregateError)
  assert.ok(called.includes('API 关键回归'))
  assert.ok(!called.includes('适配器回归'))
})
