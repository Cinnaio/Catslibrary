/** 网盘目录只是更新候选；正文比对与应用仍走书籍导入预览。 */
export interface SupplementaryFile {
  key: string
  url: string
  name: string
  folder: string
  size: string
  title: string
  author: string
  revision: number | null
  stale?: boolean
  /** 文件本身已读取，但所在目录的后续分页没有完成。 */
  incomplete?: boolean
}
export interface SupplementarySource {
  id: string
  name: string
  url: string
  hasPassword: boolean
  enabled: boolean
  intervalHours: number
  checkedAt: number
  nextCheckAt: number
  status: 'never' | 'ok' | 'partial' | 'error'
  error: string
  fileCount: number
}
export interface SupplementaryBinding {
  id: string
  sourceId: string
  novelId: string
  novelTitle: string
  aliasTitle: string
  aliasAuthor: string
  candidates: SupplementaryFile[]
}
export interface SupplementaryOverview {
  sources: SupplementarySource[]
  bindings: SupplementaryBinding[]
}

export interface SupplementaryBook {
  key: string
  title: string
  author: string
  highestRevision: number | null
  versions: SupplementaryFile[]
}
export interface SupplementaryCatalog {
  grouped: true
  items: SupplementaryBook[]
  /** 当前查询匹配的书籍数，分页以书籍为单位。 */
  total: number
  fileCount: number
  folders: Array<{ name: string; fileCount: number; incomplete: boolean; staleCount: number }>
}
export function supplementaryIdentityKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s《》「」]/g, '')
    .toLocaleLowerCase()
}
export function compareSupplementaryVersions(a: SupplementaryFile, b: SupplementaryFile): number {
  return b.folder.localeCompare(a.folder, 'zh-CN', { numeric: true }) || (b.revision ?? -1) - (a.revision ?? -1) || a.key.localeCompare(b.key)
}
/** 只归并完整书名和作者一致的文件，不用短标题或进度数字推断作品身份。 */
export function groupSupplementaryFiles(files: SupplementaryFile[]): SupplementaryBook[] {
  const groups = new Map<string, SupplementaryBook>()
  for (const file of files) {
    const key = JSON.stringify([supplementaryIdentityKey(file.title), supplementaryIdentityKey(file.author)])
    let book = groups.get(key)
    if (!book) {
      book = { key, title: file.title, author: file.author, highestRevision: null, versions: [] }
      groups.set(key, book)
    }
    if (book.versions.some((version) => version.key === file.key)) continue
    book.versions.push(file)
    if (file.revision !== null) book.highestRevision = Math.max(book.highestRevision ?? 0, file.revision)
  }
  for (const group of groups.values()) group.versions.sort(compareSupplementaryVersions)
  return [...groups.values()].sort((a, b) => compareSupplementaryVersions(a.versions[0]!, b.versions[0]!) || a.title.localeCompare(b.title, 'zh-CN'))
}
export function supplementaryCatalog(files: SupplementaryFile[], query = '', offset = 0): SupplementaryCatalog {
  const needle = query.trim().toLocaleLowerCase()
  const books = groupSupplementaryFiles(files).filter(
    (book) =>
      !needle || `${book.title} ${book.author}`.toLocaleLowerCase().includes(needle) || book.versions.some((f) => f.name.toLocaleLowerCase().includes(needle)),
  )
  const folders = new Map<string, SupplementaryCatalog['folders'][number]>()
  for (const file of files) {
    const folder = folders.get(file.folder) || { name: file.folder, fileCount: 0, incomplete: false, staleCount: 0 }
    folder.fileCount++
    folder.incomplete ||= !!file.incomplete
    folder.staleCount += file.stale ? 1 : 0
    folders.set(file.folder, folder)
  }
  return {
    grouped: true,
    items: books.slice(offset, offset + 30),
    total: books.length,
    fileCount: books.reduce((n, b) => n + b.versions.length, 0),
    folders: [...folders.values()].sort((a, b) => b.name.localeCompare(a.name, 'zh-CN', { numeric: true })),
  }
}
