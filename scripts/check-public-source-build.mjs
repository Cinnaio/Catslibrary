import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildInfo } from '../api/dist/build-info.js'

if (buildInfo.sourceAdapterRevision) throw new Error('公开发布包带有私有书源版本标记')

for (const dir of ['api/dist', 'web/dist']) {
  const files = await readdir(dir, { recursive: true, withFileTypes: true })
  for (const entry of files) {
    if (!entry.isFile() || !/\.(?:js|map|html|sql)$/.test(entry.name)) continue
    const path = join(entry.parentPath, entry.name)
    const source = await readFile(path, 'utf8')
    if (/(?:^|[\\/])private-sources[\\/]|members\.po18\.tw|https?:\/\/[^\s"'`]*\b(?:po18\.tw|po18x\.vip)(?:[/?#]|$)/im.test(source)) {
      throw new Error(`公开发布包包含私有书源路径或端点 (${path})`)
    }
  }
}
