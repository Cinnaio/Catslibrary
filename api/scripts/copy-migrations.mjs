import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/db/migrations')
const target = resolve(root, 'dist/migrations')

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

console.log(`[build] copied migrations to ${target}`)

const assets = resolve(root, 'dist/assets')
await mkdir(assets, { recursive: true })
await cp(resolve(root, '../web/public/images/default-cover-flower.webp'), resolve(assets, 'default-cover-flower.webp'))
console.log('[build] copied default cover artwork')
