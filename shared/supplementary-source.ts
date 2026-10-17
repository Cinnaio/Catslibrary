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
