import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// Always own a fresh localhost cluster. Never accept a production database URL.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(path.join(repo, '.tmp'), { recursive: true })
const root = await mkdtemp(path.join(repo, '.tmp', 'reader-reliability-'))
const env = { ...process.env, TEMP: root, TMP: root, ENV_FILE: path.join(root, '.env'), RUNTIME_CONFIG_DIR: root }
for (const key of Object.keys(env)) if (/^PG/.test(key) || key === 'DATABASE_URL' || key === 'READER_RELIABILITY_TEST_DATABASE_URL') delete env[key]
const suffix = process.platform === 'win32' ? '.exe' : ''
const dirs = [process.env.READER_TEST_PG_BIN, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean)
try {
  const versions = await readdir('/usr/lib/postgresql')
  dirs.push(...versions.sort((a, b) => Number(b) - Number(a)).map(version => `/usr/lib/postgresql/${version}/bin`))
} catch { /* Use PATH or READER_TEST_PG_BIN on other systems. */ }
let bin
for (const dir of dirs) {
  try { await access(path.join(dir, `initdb${suffix}`)); bin = dir; break } catch { /* Next candidate. */ }
}
if (!bin) throw new Error('Install PostgreSQL or set READER_TEST_PG_BIN to its bin directory')

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`${path.basename(command)} failed (${code}):\n${output}`)
  return output
}

const server = createServer().listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const data = path.join(root, 'data')
const ctl = path.join(bin, `pg_ctl${suffix}`)
let started = false
try {
  await run(path.join(bin, `initdb${suffix}`), ['-D', data, '-U', 'reader_fixture', '--auth=trust', '--no-locale', '--encoding=UTF8'])
  await run(ctl, ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  started = true
  const admin = new pg.Pool({ host: '127.0.0.1', port, user: 'reader_fixture', database: 'postgres' })
  try {
    await admin.query('CREATE DATABASE reader_reliability_test')
    console.log((await admin.query('SELECT version()')).rows[0].version)
  } finally { await admin.end() }
  env.READER_RELIABILITY_TEST_DATABASE_URL = `postgres://reader_fixture@127.0.0.1:${port}/reader_reliability_test`
  console.log(await run(process.execPath, [path.join(repo, 'node_modules/vitest/vitest.mjs'), 'run',
    'src/routes/reader-reliability.test.ts', '--configLoader', 'runner', '--maxWorkers=1', '--minWorkers=1'], { cwd: path.join(repo, 'api') }))
} finally {
  if (started) await run(ctl, ['-D', data, '-w', '-m', 'immediate', 'stop'])
  console.log(`Isolated fixture stopped; logs retained at ${root}`)
}
