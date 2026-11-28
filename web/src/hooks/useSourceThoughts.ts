import { useEffect, useState } from 'react'
import type { SourceThoughtCounts, SourceThoughtPage } from '@shared/source-thoughts'
import { request } from '@/lib/api'
export function sourceThoughtRequest<T>(params: Record<string, string>): Promise<T> {
  return request('GET', `/source-thoughts?${new URLSearchParams(params)}`, null, true, {}, 35000)
}
export interface SourceThoughtAnchor { chapterId: string; paragraphIndex: number; paragraphHash: string }
export function sourceThoughtPage(anchor: SourceThoughtAnchor, cursor = '', commentId?: string) {
  return sourceThoughtRequest<SourceThoughtPage>({ chapterId: anchor.chapterId, paragraphIndex: String(anchor.paragraphIndex),
    paragraphHash: anchor.paragraphHash, action: commentId ? 'replies' : 'comments', cursor, ...(commentId ? { commentId } : {}) })
}
export function useSourceThoughts(chapterId: string, enabled: boolean, scope: string) {
  const [attempt, setAttempt] = useState(0)
  const key = `${chapterId}:${enabled}:${scope}:${attempt}`
  const [state, setState] = useState<{ key: string; data?: SourceThoughtCounts; error: string }>({ key: '', error: '' })
  useEffect(() => {
    let current = true
    if (enabled && chapterId) void sourceThoughtRequest<SourceThoughtCounts>({ chapterId }).then(data => {
      if (current) setState({ key, data, error: '' })
    }).catch(() => { if (current) setState({ key, error: '来源想法暂时无法加载' }) })
    return () => { current = false }
  }, [chapterId, enabled, key])
  const current = state.key === key ? state : { error: '', data: undefined }
  return { data: current.data, error: current.error, loading: enabled && !!chapterId && state.key !== key, retry: () => setAttempt(value => value + 1) }
}
export type SourceThoughtState = ReturnType<typeof useSourceThoughts>
