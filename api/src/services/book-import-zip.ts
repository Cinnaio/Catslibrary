import { unzipSync } from 'fflate'
import { posix } from 'node:path'
import { parseUploadedBookDetailed } from './book-import'
import { makeImportCover } from './book-import-cover'

const MAX_BYTES = 64 * 1024 * 1024
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

/** Read into bounded memory only: archive paths never reach the filesystem or network. */
export async function parseBookZip(data: Uint8Array) {
  if (data.byteLength > MAX_BYTES) throw new Error('ZIP 文件不能超过 64 MB')
  let total = 0,
    count = 0
  const paths = new Set<string>()
  const files = unzipSync(data, {
    filter(entry) {
      if (++count > 400) throw new Error('ZIP 文件条目过多，最多支持 400 项')
      const path = entry.name
      if (
        !path ||
        path.startsWith('/') ||
        /[\\\x00-\x1f]/.test(path) ||
        /^[A-Za-z]:/.test(path) ||
        path.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('ZIP 文件包含不安全路径')
      const key = path.normalize('NFC').toLocaleLowerCase()
      if (paths.has(key)) throw new Error('ZIP 文件包含重名路径，请整理后再导入')
      paths.add(key)
      total += entry.originalSize
      if (total > MAX_BYTES) throw new Error('ZIP 解压内容超过 64 MB，请拆分后导入')
      return !path.endsWith('/')
    },
  })
  const texts = Object.keys(files).filter(
    (name) => /\.(txt|text|json|epub)$/i.test(name) && !/(^|\/)(封面说明|导出说明|readme)\.txt$/i.test(name) && !name.startsWith('__MACOSX/'),
  )
  if (!texts.length || texts.length > 100) throw new Error('ZIP 中需要包含 1–100 本 TXT、JSON 或 EPUB 书籍')
  const books = []
  let expandedTotal = total
  for (const path of texts.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))) {
    if (/\.epub$/i.test(path)) {
      let innerBytes = 0,
        innerCount = 0
      unzipSync(files[path]!, {
        filter(entry) {
          innerBytes += entry.originalSize
          expandedTotal += entry.originalSize
          if (++innerCount > 2000 || innerBytes > MAX_BYTES || expandedTotal > MAX_BYTES) throw new Error(`${path} 的 EPUB 解压内容过大，请单独核对文件`)
          return false
        },
      })
    }
    const detail = await parseUploadedBookDetailed(posix.basename(path), files[path]!)
    if (detail.diagnostics.stats.headingLines > 1000) throw new Error(`${path} 的章节达到导入上限，请拆分文件后导入`)
    const folder = posix.dirname(path)
    const stem = posix.basename(path, posix.extname(path))
    const images = Object.keys(files).filter(
      (name) =>
        posix.dirname(name) === folder &&
        TYPES[posix.extname(name).toLowerCase()] &&
        (posix.basename(name, posix.extname(name)) === '封面' ||
          posix.basename(name, posix.extname(name)).toLowerCase() === 'cover' ||
          posix.basename(name, posix.extname(name)) === stem),
    )
    const generic = images.filter((name) => /^(封面|cover)$/i.test(posix.basename(name, posix.extname(name))))
    if (generic.length && texts.filter((name) => posix.dirname(name) === folder).length > 1)
      throw new Error(`${folder} 下有多本书和通用封面，无法确定对应关系，请按书分目录`)
    if (images.length > 1) throw new Error(`${path} 对应多个封面，请只保留当前封面`)
    if (images[0]) detail.payload.coverImage = makeImportCover(files[images[0]]!, TYPES[posix.extname(images[0]).toLowerCase()]!)
    books.push({ path, detail, sourceText: detail.diagnostics.stats.parser === 'text' ? new TextDecoder().decode(files[path]!) : '' })
  }
  return books
}
