// Run with the locked workspace dependencies: node scripts/analyze-web-bundle.mjs [label].
// Output stays under .tmp; never overwrites web/dist or changes the dev server.
import { build } from 'vite'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(path.join(root, 'web'))
const label = process.argv[2] || 'current'
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a simple alphanumeric label')
const output = path.join(root, '.tmp', 'performance', label)
const relative = (id) => path.relative(root, id.split('?')[0]).replaceAll('\\', '/')
let report
await build({
  root: path.join(root, 'web'),
  configFile: path.join(root, 'web/vite.config.ts'),
  logLevel: 'warn',
  build: { outDir: path.join(output, 'dist'), emptyOutDir: true, manifest: true, reportCompressedSize: false },
  plugins: [{
    name: 'report-initial-dependencies',
    async generateBundle(_options, bundle) {
      const initial = new Set()
      const visit = (name) => {
        if (initial.has(name)) return
        initial.add(name)
        const chunk = bundle[name]
        if (chunk?.type === 'chunk') chunk.imports.forEach(visit)
      }
      Object.values(bundle).filter((item) => item.type === 'chunk' && item.isEntry).forEach((item) => visit(item.fileName))
      const files = [], modules = [], cssSources = []
      for (const name of initial) {
        const chunk = bundle[name]
        if (chunk?.type !== 'chunk') continue
        files.push({ file: name, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length })
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (id.includes('.css')) {
            const sourceBytes = await stat(id.split('?')[0]).then((s) => s.size).catch(() => 0)
            cssSources.push({ id: relative(id), sourceBytes })
          } else if (info.renderedLength) {
            modules.push({ id: relative(id), renderedBytes: info.renderedLength })
          }
        }
        for (const css of chunk.viteMetadata?.importedCss || []) initial.add(css)
      }
      for (const name of initial) {
        const item = bundle[name]
        if (item?.type !== 'asset' || !name.endsWith('.css')) continue
        const source = typeof item.source === 'string' ? item.source : Buffer.from(item.source)
        files.push({ file: name, bytes: Buffer.byteLength(source), gzipBytes: gzipSync(source).length })
      }
      const total = (extension, field) => files.filter((f) => f.file.endsWith(extension)).reduce((sum, f) => sum + f[field], 0)
      report = {
        node: process.versions.node,
        vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
        initial: { jsBytes: total('.js', 'bytes'), jsGzipBytes: total('.js', 'gzipBytes'), cssBytes: total('.css', 'bytes'), cssGzipBytes: total('.css', 'gzipBytes') },
        files,
        // renderedLength is before final minification, attribution only; don't sum it as transfer bytes.
        modules: modules.sort((a, b) => b.renderedBytes - a.renderedBytes),
        cssSources: cssSources.sort((a, b) => b.sourceBytes - a.sourceBytes),
      }
    },
  }],
})
await mkdir(output, { recursive: true })
// Read the final emitted bytes, after Vite's other output hooks have run.
for (const file of report.files) {
  const bytes = await readFile(path.join(output, 'dist', file.file))
  file.bytes = bytes.length
  file.gzipBytes = gzipSync(bytes).length
}
for (const [prefix, extension] of [['js', '.js'], ['css', '.css']]) {
  report.initial[`${prefix}Bytes`] = report.files.filter(f => f.file.endsWith(extension)).reduce((sum, f) => sum + f.bytes, 0)
  report.initial[`${prefix}GzipBytes`] = report.files.filter(f => f.file.endsWith(extension)).reduce((sum, f) => sum + f.gzipBytes, 0)
}
await writeFile(path.join(output, 'bundle.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ label, ...report.initial, report: path.join(output, 'bundle.json') }, null, 2))
