import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parseArgs, selectAdapterRef, quote } from './deploy-private.mjs'

const state = { releaseSha: 'a'.repeat(40), sourceAdapterRevision: 'b'.repeat(40) }
test('核心更新默认固定线上适配器，仅显式指定时更新私有提交', () => {
  assert.equal(selectAdapterRef(parseArgs([]), state), state.sourceAdapterRevision)
  assert.equal(selectAdapterRef(parseArgs(['--adapter-ref', 'HEAD']), state), 'HEAD')
  assert.equal(selectAdapterRef(parseArgs([]), { ...state, sourceAdapterRevision: null }), 'HEAD')
  assert.throws(() => selectAdapterRef(parseArgs([]), { ...state, sourceAdapterRevision: '' }))
  assert.throws(() => selectAdapterRef(parseArgs([]), { ...state, releaseSha: 'short' }))
})
test('构建主机必须独立，SSH 参数及命令引用不会穿透', () => {
  assert.throws(() => parseArgs(['--build-host', 'story']))
  assert.throws(() => parseArgs(['--build-host', '-oProxyCommand=bad']))
  assert.throws(() => parseArgs(['--deploy-host', 'story;pwd']))
  assert.throws(() => parseArgs(['--unknown', 'value']))
  assert.equal(quote("a'b $x `pwd`"), "'a'\\''b $x `pwd`'")
  assert.equal(parseArgs(['--build-only']).buildOnly, true)
})
test('清单伪报私有版本时，真实运行时检查拒绝执行', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catslibrary-runtime-policy-'))
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await writeFile(join(directory, 'check-release-runtime.mjs'), await readFile(new URL('./check-release-runtime.mjs', import.meta.url)))
    const metadata = { releaseSha: state.releaseSha, apiVersion: '1.0.0', webVersion: '1.0.0', lockHash: 'test', nodeVersion: process.versions.node, migrations: [] }
    await writeFile(join(directory, 'build-info.js'), `export const buildInfo = ${JSON.stringify(metadata)}`)
    await writeFile(join(directory, 'release.json'), JSON.stringify({ ...metadata, format: 2, platform: process.platform, arch: process.arch, builtinUndici: process.versions.undici, sourceAdapterRevision: state.sourceAdapterRevision }))
    const result = spawnSync(process.execPath, [join(directory, 'check-release-runtime.mjs')], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /sourceAdapterRevision 不一致/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
