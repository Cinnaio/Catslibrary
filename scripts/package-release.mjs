import { cp, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile, chmod } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { dirname, join, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1]
  if (!['--output', '--api-dist', '--web-dist'].includes(key) || !value) throw new Error('用法：npm run release:package -- --output <新目录> [--api-dist <目录>] [--web-dist <目录>]')
  args.set(key, value)
}
if (!args.has('--output')) throw new Error('必须指定不存在的输出目录')
const output = resolve(args.get('--output'))
const apiDist = resolve(args.get('--api-dist') || join(root, 'api/dist'))
const webDist = resolve(args.get('--web-dist') || join(root, 'web/dist'))
const pinnedNode = (await readFile(join(root, '.node-version'), 'utf8')).trim()
if (process.versions.node !== pinnedNode) throw new Error(`发布打包必须使用 Node ${pinnedNode}，当前 ${process.versions.node}`)
if (!process.env.npm_execpath) throw new Error('请通过 npm run release:package 执行')
const { buildInfo } = await import(pathToFileURL(join(apiDist, 'build-info.js')).href)
const lock = await readFile(join(root, 'package-lock.json'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
if (!/^[0-9a-f]{40}$/.test(buildInfo.releaseSha)) throw new Error('API 必须带完整 RELEASE_SHA 构建')
if (buildInfo.lockHash !== digest(lock) || buildInfo.nodeVersion !== pinnedNode) throw new Error('构建与锁文件或 Node 版本不一致，请重新构建')
await mkdir(output) // 不覆盖任何已有产物。
const scratch = await mkdtemp(join(tmpdir(), 'zhi-zhou-runtime-'))

function runNode(script, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: 'inherit', env: process.env })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`发布准备命令失败 (${code})`)))
  })
}
try {
  for (const file of ['package.json', 'package-lock.json', 'api/package.json', 'web/package.json']) {
    await mkdir(dirname(join(scratch, file)), { recursive: true })
    await copyFile(join(root, file), join(scratch, file))
  }
  // 同一个 workspace 锁文件，只安装 API 生产依赖；不触碰开发目录，也不在服务器安装。
  await runNode(process.env.npm_execpath, ['ci', '--workspace=@zhi-zhou/api', '--omit=dev', '--bin-links=false', '--no-audit', '--no-fund'], scratch)
  const target = join(output, 'api/dist')
  await mkdir(dirname(target), { recursive: true })
  await mkdir(join(output, 'web'), { recursive: true })
  const filter = source => !source.endsWith('.map')
  await cp(apiDist, target, { recursive: true, filter })
  await cp(webDist, join(output, 'web/dist'), { recursive: true, filter })
  const workspaceLink = join(scratch, 'node_modules/@zhi-zhou/api')
  if ((await lstat(workspaceLink).catch(() => null))?.isSymbolicLink()) await unlink(workspaceLink)
  await cp(join(scratch, 'node_modules'), join(target, 'node_modules'), { recursive: true, filter })
  const localModules = join(scratch, 'api/node_modules')
  if ((await readdir(localModules).catch(error => { if (error.code === 'ENOENT') return []; throw error })).length) {
    throw new Error('API 存在 workspace 内嵌依赖；发布器须保留其解析层级，不能合并覆盖根依赖')
  }
  const apiPackage = JSON.parse(await readFile(join(root, 'api/package.json'), 'utf8'))
  const dependencies = {}
  for (const name of Object.keys(apiPackage.dependencies)) {
    dependencies[name] = JSON.parse(await readFile(join(target, 'node_modules', name, 'package.json'), 'utf8')).version
  }
  await writeFile(join(target, 'package.json'), JSON.stringify({ name: '@zhi-zhou/api-release', private: true, type: 'module', version: buildInfo.apiVersion, dependencies }, null, 2) + '\n')
  await copyFile(join(root, 'package-lock.json'), join(target, 'release-lock.json'))
  await copyFile(join(root, 'scripts/check-release-runtime.mjs'), join(target, 'check-release-runtime.mjs'))
  await mkdir(join(target, 'runtime'))
  const executable = `api/dist/runtime/${process.platform === 'win32' ? 'node.exe' : 'node'}`
  await copyFile(process.execPath, join(output, executable))
  await chmod(join(output, executable), 0o755)
  const files = {}
  async function inventory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`发布包不允许符号链接: ${file}`)
      if (entry.isDirectory()) await inventory(file)
      else files[relative(output, file).split(sep).join('/')] = digest(await readFile(file))
    }
  }
  await inventory(output)
  const manifest = { format: 2, ...buildInfo, platform: process.platform, arch: process.arch, builtinUndici: process.versions.undici, executable, dependencies, files }
  await writeFile(join(target, 'release.json'), JSON.stringify(manifest, null, 2) + '\n')
  await runNode(join(target, 'check-release-runtime.mjs'), [], output)
  console.log(`完整发布目录: ${output} (${Object.keys(files).length} files, ${manifest.platform}/${manifest.arch}, Node ${pinnedNode})`)
} finally {
  // scratch 仅来自本次 mkdtemp，永不删除用户提供的 output 或开发依赖。
  // Windows 的 npm workspace 联接点可能到子进程完全退出后才释放；
  // 清理告警不应覆盖打包结果或原始失败，CI 的临时目录会随 runner 回收。
  await rm(scratch, { recursive: true, force: true }).catch(error => {
    console.warn(`打包临时目录未完全清理 (${error.code}): ${scratch}`)
  })
}
