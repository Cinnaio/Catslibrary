import { defineConfig } from 'tsup'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const releaseSha = process.env.RELEASE_SHA || process.env.GITHUB_SHA || 'development'
if (releaseSha !== 'development' && !/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('RELEASE_SHA 必须是完整 Git SHA')
const metadata = {
  apiVersion: JSON.parse(read('./package.json')).version,
  webVersion: JSON.parse(read('../web/package.json')).version,
  releaseSha,
  lockHash: createHash('sha256').update(read('../package-lock.json')).digest('hex'),
  nodeVersion: read('../.node-version').trim(),
  migrations: readdirSync(new URL('./src/db/migrations/', import.meta.url)).filter(name => /^\d+.*\.sql$/.test(name)).map(name => ({ version: Number.parseInt(name, 10), name })),
}

export default defineConfig({
  entry: { index: 'src/index.ts', 'recover-super-admin': 'scripts/recover-super-admin.ts', 'build-info': 'src/services/build-info.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // 其他运行依赖由发布打包器随 dist 交付；保留此解码器的现有内联方式。
  noExternal: ['entities'],
  define: { __BUILD_INFO__: JSON.stringify(metadata) },
  alias: {
    '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
  },
})
