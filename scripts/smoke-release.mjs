import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('用法：node scripts/smoke-release.mjs <发布目录>')
const info = JSON.parse(await readFile(join(root, 'api/dist/release.json'), 'utf8'))
const temporary = await mkdtemp(join(tmpdir(), 'zhi-zhou-release-smoke-'))
const listener = createServer()
listener.listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise(resolveClose => listener.close(resolveClose))
const env = {}
for (const name of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME']) if (process.env[name]) env[name] = process.env[name]
Object.assign(env, {
  NODE_ENV: 'production', PORT: String(port), ENV_FILE: join(temporary, '.env'), RUNTIME_CONFIG_DIR: temporary,
  BACKUP_CONFIG_FILE: join(temporary, 'backups.json'), MAIL_CONFIG_FILE: join(temporary, 'mail.json'), MAIL_SECURITY_CONFIG_FILE: join(temporary, 'mail-security.json'),
  DATABASE_URL: process.env.RELEASE_SMOKE_DATABASE_URL || '',
})
const child = spawn(join(root, info.executable), [join(root, 'api/dist/index.js')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
const stopped = new Promise(resolveStop => { child.once('exit', resolveStop); child.once('error', resolveStop) })
const running = () => Boolean(child.pid) && child.exitCode === null && child.signalCode === null
let output = ''
child.stdout.on('data', data => { output = (output + data).slice(-12000) })
child.stderr.on('data', data => { output = (output + data).slice(-12000) })
let spawnError
child.on('error', error => { spawnError = error })
const base = `http://127.0.0.1:${port}`
const get = path => fetch(base + path, { signal: AbortSignal.timeout(3000) })
try {
  let health
  const deadline = Date.now() + 45000
  for (let i = 0; i < 150 && Date.now() < deadline; i++) {
    if (spawnError) throw spawnError
    if (!running()) throw new Error(`隔离发布包提前退出: ${output}`)
    try { health = await get('/api/health'); if (health.ok) break } catch { /* 等待本次独立进程启动。 */ }
    await delay(200)
  }
  assert.equal(health?.status, 200, output)
  assert.equal((await health.json()).release, info.releaseSha)
  const ready = await get('/api/ready'), state = await ready.json()
  assert.equal(state.release, info.releaseSha)
  assert.equal(state.version, info.apiVersion)
  assert.equal(ready.status, env.DATABASE_URL ? 200 : 503)
  assert.equal(state.ready, Boolean(env.DATABASE_URL))
  const home = await get('/')
  assert.equal(home.status, 200)
  const html = await home.text()
  const entry = html.match(/(?:src|href)="(\/assets\/[^"?]+\.js)"/)?.[1]
  assert.ok(entry, '首页须引用真实构建的入口资源')
  assert.equal((await get(entry)).status, 200)
  assert.equal((await get('/api/novels?limit=1')).status, env.DATABASE_URL ? 200 : 503)
  console.log(`隔离发布包启动、版本、页面与业务就绪检查通过 (${env.DATABASE_URL ? 'PostgreSQL' : '未配置数据库明确返回 503'})`)
} finally {
  if (running()) {
    child.kill('SIGTERM')
    await Promise.race([stopped, delay(3000, undefined, { ref: false })])
    if (running()) { child.kill('SIGKILL'); await stopped }
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
