import type { KeepsakeContext, KeepsakeInput, KeepsakePage, ReadingKeepsake } from '@shared/reading-keepsakes'
import { request } from './api'

export function keepsakePath(novelId: string, mode: string, suffix = '') {
  return `/reading-keepsakes/${encodeURIComponent(novelId)}${suffix}?contentMode=${encodeURIComponent(mode)}`
}
export const keepsakesApi = {
  context: (id: string, mode: string) => request<KeepsakeContext>('GET', keepsakePath(id, mode, '/context'), undefined, true),
  list: (id: string, mode: string, cursor?: string) => request<KeepsakePage>('GET', keepsakePath(id, mode) + (cursor ? `&before=${encodeURIComponent(cursor)}` : ''), undefined, true),
  save: (id: string, mode: string, input: KeepsakeInput) => request<{ item: ReadingKeepsake }>('POST', keepsakePath(id, mode), input, true),
  remove: (id: string, mode: string, cardId: string) => request<{ ok: boolean }>('DELETE', keepsakePath(id, mode, `/${encodeURIComponent(cardId)}`), undefined, true),
}
export function keepsakeDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(value)
}
export function keepsakeText(item: ReadingKeepsake) {
  return ['合上书以后', `《${item.title}》${item.author ? ` · ${item.author}` : ''}`,
    ...(item.startedAt ? [`阅读记录起于 ${keepsakeDate(item.startedAt)}`] : []), `留于 ${keepsakeDate(item.savedAt)}`,
    ...item.moments.flatMap(m => ['', m.selectedText ? `“${m.selectedText}”` : '', `—— ${m.chapterTitle}`, m.thoughtText]),
    ...(item.closing ? ['', '这本书留给我的是……', item.closing] : [])].filter(line => line !== undefined).join('\n')
}
