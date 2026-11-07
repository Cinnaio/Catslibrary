import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8'))
if (manifest.format !== 2 || process.versions.node !== manifest.nodeVersion || process.platform !== manifest.platform || process.arch !== manifest.arch) {
  throw new Error('运行时与发布清单不匹配')
}
if (process.versions.undici !== manifest.builtinUndici) throw new Error('Node 内置 Undici 与发布清单不匹配')
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const entry = fileURLToPath(import.meta.resolve(name))
  if (!entry.startsWith(resolve(root, 'node_modules') + sep)) throw new Error(`${name} 回退到了发布包之外的依赖`)
  const installed = JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'))
  if (installed.version !== version) throw new Error(`${name} 版本与清单不一致`)
  await import(name)
}
const { default: sharp } = await import('sharp')
await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
console.log(`运行时、全部 API 直接依赖与原生图像库检查通过 (${manifest.releaseSha})`)
