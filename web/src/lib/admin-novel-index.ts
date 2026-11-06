import type { AdminNovelIndexItem } from '@shared/types'
import { adminApi } from './api'

/** 每次只传输紧凑书目；完整读取后再交给下拉筛选，不把某一页误当成全库。 */
export async function loadAdminNovelIndex(q = '', isActive = () => true): Promise<AdminNovelIndexItem[]> {
  const novels = new Map<string, AdminNovelIndexItem>()
  let offset = 0
  while (isActive()) {
    const data = await adminApi.novelIndex({ q, limit: '500', offset: String(offset) })
    if (!isActive()) break
    for (const novel of data.novels) novels.set(novel.id, novel)
    if (!data.hasMore) break
    if (!data.novels.length) throw new Error('书目索引分页未返回后续作品，请重试')
    offset += data.novels.length
  }
  return [...novels.values()]
}
