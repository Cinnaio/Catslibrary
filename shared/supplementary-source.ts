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
export type SupplementaryUpdateMode = 'manual' | 'preview' | 'append'
export interface SupplementaryUpdateResult {
  status: 'no-file' | 'unchanged' | 'review' | 'added' | 'manual-download' | 'failed' | 'rolled-back'
  checkedAt: number
  message?: string
  fileName?: string
  runId?: string
  addedCount?: number
}
export interface SupplementaryBinding {
  id: string
  sourceId: string
  novelId: string
  novelTitle: string
  aliasTitle: string
  aliasAuthor: string
  candidates: SupplementaryFile[]
  updateMode?: SupplementaryUpdateMode
  updateResult?: SupplementaryUpdateResult | null
  updating?: boolean
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
/**
 * 目录名里的日期折算成 MMDD。发布者常在 `11.26` 与 `1123` 之间换写法，
 * 纯数字自然序会把 `1123` 当成 1123 排到 `11.26` 前面，导致「最新目录」停在旧包。
 */
function folderUnitKey(unit: string): number {
  const name = unit.trim()
  let month = 0
  let day = 0
  let match = name.match(/^\d{4}\s*[.\-_/年]\s*(\d{1,2})\s*[.\-_/月]\s*(\d{1,2})/)
  if (match) {
    month = Number(match[1])
    day = Number(match[2])
  } else if ((match = name.match(/^(\d{1,2})\s*[.\-_/月]\s*(\d{1,2})(?!\d)/))) {
    month = Number(match[1])
    day = Number(match[2])
  } else if ((match = name.match(/^(\d{1,2})月$/))) {
    return Number(match[1]) * 100
  } else if ((match = name.match(/^(\d{3,4})$/))) {
    month = Number(match[1]!.slice(0, match[1]!.length - 2))
    day = Number(match[1]!.slice(-2))
  } else {
    return Number.NaN
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN
  return month * 100 + day
}
/** 目录按日期倒序；解析不出日期时退回名称自然序，保证排序始终是全序。 */
export function compareSupplementaryFolders(a: string, b: string): number {
  const unitsA = a.split('/').filter(Boolean)
  const unitsB = b.split('/').filter(Boolean)
  for (let i = 0; i < Math.min(unitsA.length, unitsB.length); i++) {
    const keyA = folderUnitKey(unitsA[i]!)
    const keyB = folderUnitKey(unitsB[i]!)
    const diff =
      Number.isFinite(keyA) && Number.isFinite(keyB)
        ? keyB - keyA
        : Number.isFinite(keyA) !== Number.isFinite(keyB)
          ? Number.isFinite(keyA)
            ? -1
            : 1
          : unitsB[i]!.localeCompare(unitsA[i]!, 'zh-CN', { numeric: true })
    if (diff) return diff
  }
  return unitsB.length - unitsA.length
}
export function compareSupplementaryVersions(a: SupplementaryFile, b: SupplementaryFile): number {
  return compareSupplementaryFolders(a.folder, b.folder) || (b.revision ?? -1) - (a.revision ?? -1) || a.key.localeCompare(b.key)
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
    folders: [...folders.values()].sort((a, b) => compareSupplementaryFolders(a.name, b.name)),
  }
}
