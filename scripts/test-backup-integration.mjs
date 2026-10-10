import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection, createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'

// Always own a fresh cluster. No externally supplied database URL is used.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(path.join(tmpdir(), 'zz-backup-ci-'))
let clusterStarted = false,
  sftp,
  tests,
  interrupted = false
let pgBin
const env = { ...process.env, RCLONE_CONFIG: path.join(root, 'rclone.conf'), RCLONE_CACHE_DIR: path.join(root, 'cache') }
for (const key of Object.keys(env)) {
  if (/^(PG|BACKUP_|RCLONE_)/.test(key) && !['RCLONE_CONFIG', 'RCLONE_CACHE_DIR'].includes(key)) delete env[key]
}
env.ENV_FILE = path.join(root, '.env')
env.RUNTIME_CONFIG_DIR = root

async function executable(name, dirs = env.PATH.split(path.delimiter)) {
  for (const dir of dirs) {
    const file = path.join(dir, name)
    try {
      await access(file, constants.X_OK)
      return file
    } catch {
      /* next directory */
    }
  }
  throw new Error(`Missing ${name}; install PostgreSQL server/client, rclone and openssh-client`)
}
async function run(command, args, options = {}) {
  const child = spawn(command, args, { env, cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let output = ''
  child.stdout?.on('data', (data) => {
    output += data
  })
  child.stderr?.on('data', (data) => {
    output += data
  })
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(`${path.basename(command)} failed (${code}): ${output}`)
  return output.trim()
}
async function freePort(host) {
  const server = createServer()
  server.listen(0, host)
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}
async function waitForSftp(host, port) {
  for (let i = 0; i < 100; i++) {
    if (sftp.exitCode !== null || interrupted) throw new Error('SFTP fixture stopped before readiness')
    const ready = await new Promise((resolve) => {
      const socket = createConnection({ host, port })
      socket.setTimeout(300)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ready) return
    await delay(100)
  }
  throw new Error('SFTP fixture did not become ready')
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const finished = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    await finished
  } finally {
    clearTimeout(timer)
  }
}
function onSignal() {
  interrupted = true
  tests?.kill('SIGTERM')
  sftp?.kill('SIGTERM')
}
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)

try {
  if (process.getuid?.() === 0) throw new Error('Run as a regular user; initdb refuses root')
  const dirs = env.PATH.split(path.delimiter)
  if (process.env.BACKUP_TEST_PG_BIN) dirs.unshift(process.env.BACKUP_TEST_PG_BIN)
  try {
    const versions = await readdir('/usr/lib/postgresql')
    dirs.push(...versions.sort((a, b) => Number(b) - Number(a)).map((v) => `/usr/lib/postgresql/${v}/bin`))
  } catch {
    /* non-Debian installation: use PATH or BACKUP_TEST_PG_BIN */
  }
  pgBin = path.dirname(await executable('initdb', dirs))
  for (const tool of ['pg_ctl', 'postgres', 'pg_dump', 'pg_restore', 'psql']) await executable(tool, [pgBin])
  env.PATH = `${pgBin}${path.delimiter}${env.PATH}`
  const rclone = process.env.BACKUP_TEST_RCLONE_PATH || (await executable('rclone'))
  await access(rclone, constants.X_OK)
  const sshKeygen = await executable('ssh-keygen')
  // Production blocks loopback SFTP. Exercise that policy using our own private interface.
  const host = Object.values(networkInterfaces())
    .flat()
    .find(
      (item) =>
        item?.family === 'IPv4' &&
        !item.internal &&
        (/^10\./.test(item.address) || /^192\.168\./.test(item.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(item.address)),
    )?.address
  if (!host) throw new Error('A private IPv4 interface is required for the SFTP fixture')
  const port = await freePort('127.0.0.1'),
    sftpPort = await freePort(host)
  await mkdir(path.join(root, 'socket'))
  await run(path.join(pgBin, 'initdb'), ['-D', path.join(root, 'pg'), '-U', 'backup_fixture', '--auth=trust', '--no-locale', '--encoding=UTF8'])
  // Mark before starting so a partial startup also gets cleaned up.
  clusterStarted = true
  await run(path.join(pgBin, 'pg_ctl'), [
    '-D',
    path.join(root, 'pg'),
    '-l',
    path.join(root, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -k ${path.join(root, 'socket')}`,
    '-w',
    'start',
  ])
  const url = (name) => `postgresql://backup_fixture@127.0.0.1:${port}/${name}`
  const databases = {
    BACKUP_INTEGRATION_DATABASE_URL: 'backup_integration',
    BACKUP_INTEGRATION_REHEARSAL_URL: 'backup_integration_shadow',
    BACKUP_IMPACT_INTEGRATION_DATABASE_URL: 'backup_integration_impact_1234abcd',
    BACKUP_IMPACT_INTEGRATION_REHEARSAL_URL: 'backup_integration_impact_1234abcd_shadow',
    BACKUP_CREATE_INTEGRATION_DATABASE_URL: 'backup_integration_rehearsal_create',
    BACKUP_REHEARSAL_MANAGEMENT_INTEGRATION_DATABASE_URL: 'backup_integration_rehearsal_management_1234abcd',
    BACKUP_OFFLINE_INTEGRATION_DATABASE_URL: 'backup_integration_offline',
    BACKUP_OFFLINE_INTEGRATION_TARGET_URL: 'backup_integration_offline_target',
  }
  const admin = new pg.Pool({ connectionString: url('postgres') })
  try {
    for (const [key, name] of Object.entries(databases)) {
      await admin.query(`CREATE DATABASE "${name}"`)
      env[key] = url(name)
    }
  } finally {
    await admin.end()
  }
  const shadow = new pg.Pool({ connectionString: env.BACKUP_INTEGRATION_REHEARSAL_URL })
  try {
    await shadow.query(`CREATE SCHEMA backup_rehearsal;
CREATE TABLE backup_rehearsal.guard(key text PRIMARY KEY, value text NOT NULL);
INSERT INTO backup_rehearsal.guard VALUES ('purpose', 'zhi-zhou-backup-rehearsal');`)
  } finally {
    await shadow.end()
  }
  await mkdir(path.join(root, 'remote', 'backups'), { recursive: true })
  await writeFile(env.RCLONE_CONFIG, '', { mode: 0o600 })
  const keyFile = path.join(root, 'host_key')
  await run(sshKeygen, ['-t', 'ed25519', '-N', '', '-f', keyFile, '-q'])
  let sftpOutput = ''
  sftp = spawn(
    rclone,
    ['serve', 'sftp', path.join(root, 'remote'), '--addr', `${host}:${sftpPort}`, '--user', 'backup', '--pass', 'fixture-password', '--key', keyFile],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  sftp.stdout.on('data', (data) => {
    sftpOutput += data
  })
  sftp.stderr.on('data', (data) => {
    sftpOutput += data
  })
  sftp.on('error', () => {})
  try {
    await waitForSftp(host, sftpPort)
  } catch (error) {
    throw new Error(`${error.message}\n${sftpOutput}`)
  }
  env.BACKUP_INTEGRATION_SFTP_HOST = host
  env.BACKUP_INTEGRATION_SFTP_PORT = String(sftpPort)
  env.BACKUP_INTEGRATION_SFTP_HOST_KEY = `${keyFile}.pub`
  env.BACKUP_INTEGRATION_RCLONE_PATH = rclone
  const report = path.join(root, 'result.json')
  console.log('Running real PostgreSQL/SFTP backup, restore and disaster recovery tests in a fresh cluster')
  tests = spawn(
    process.execPath,
    [
      path.join(repo, 'node_modules/vitest/vitest.mjs'),
      'run',
      'src/services/backups',
      '--no-file-parallelism',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
    ],
    { env, cwd: path.join(repo, 'api'), stdio: 'inherit' },
  )
  const [code] = await once(tests, 'exit')
  if (code !== 0 || interrupted) throw new Error(`Backup integration tests failed (${code})`)
  const results = JSON.parse(await readFile(report, 'utf8'))
  if (results.numPendingTests || results.numFailedTests || !results.numTotalTests) throw new Error('Backup integration tests must pass with zero skipped tests')
  const expected = [
    'integration.test.ts',
    'impact.integration.test.ts',
    'rehearsal-create.integration.test.ts',
    'rehearsal-management.integration.test.ts',
    'offline.integration.test.ts',
  ]
  for (const file of expected) {
    const suite = results.testResults.find((item) => path.basename(item.name) === file)
    if (!suite?.assertionResults.length || suite.assertionResults.some((test) => test.status !== 'passed'))
      throw new Error(`Missing or incomplete integration suite: ${file}`)
  }
  console.log(`Backup verification passed: ${results.numTotalTests} tests, zero skipped`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await stop(tests)
  await stop(sftp)
  let stopped = !clusterStarted
  if (clusterStarted) {
    try {
      await run(path.join(pgBin, 'pg_ctl'), ['-D', path.join(root, 'pg'), '-m', 'immediate', '-w', 'stop'])
      stopped = true
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
  if (stopped) await rm(root, { recursive: true, force: true })
  else console.error(`Cluster cleanup failed; retained ${root}`)
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
}
