import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalBookmark } from '@shared/types'
import { bookmarksApi, getToken } from '../lib/api'
import { getAllBookmarks, getStorageScope, replaceAllBookmarks } from '../lib/storage'
import { useSession } from '../context/SessionContext'

/** 云端权威读、逐条写；旧设备缓存不能复活删除项或覆盖其它设备数据。 */
export function useBookmarks() {
  const { user, loading } = useSession()
  const [snapshot, setSnapshot] = useState(() => ({ scope: getStorageScope(), bookmarks: getAllBookmarks() }))
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  const revision = useRef(0)
  const [error, setError] = useState('')
  const cancelReads = useCallback(() => { revision.current++ }, [])

  const reload = useCallback(async () => {
    const seq = ++revision.current
    const token = getToken()
    const scope = getStorageScope()
    const current = () => seq === revision.current && token === getToken() && scope === getStorageScope()
    await Promise.resolve()
    if (!current()) return
    if (loading) return
    setError('')
    if (!user) { setSnapshot({ scope, bookmarks: getAllBookmarks() }); return }
    if (scope !== `user:${user.id}`) return
    try {
      const data = await bookmarksApi.list()
      if (!current()) return
      replaceAllBookmarks(data.bookmarks)
      setSnapshot({ scope, bookmarks: getAllBookmarks() })
      setError('')
    } catch (err) {
      if (current()) setError((err as Error).message || '书签加载失败')
    }
  }, [user, loading])

  useEffect(() => {
    void reload()
    return cancelReads
  }, [reload, cancelReads])

  const change = useCallback(async (bookmark: LocalBookmark, remove = false) => {
    if (mutation.current || loading) return false
    const token = getToken()
    const scope = getStorageScope()
    if (token && (!user || scope === 'pending')) throw new Error('请等待登录状态确认后重试')
    mutation.current = true
    revision.current++ // 先前的列表请求不能覆盖本次操作。
    setBusy(true)
    try {
      let saved = bookmark
      if (token) {
        if (remove) await bookmarksApi.remove(bookmark.novelId, bookmark.chapterId)
        else saved = (await bookmarksApi.save(bookmark)).bookmark
      }
      if (token !== getToken() || scope !== getStorageScope()) return false
      const next = getAllBookmarks().filter(b => b.novelId !== bookmark.novelId || b.chapterId !== bookmark.chapterId)
      if (!remove) next.push(saved)
      replaceAllBookmarks(next)
      setSnapshot({ scope, bookmarks: getAllBookmarks() })
      setError('')
      return true
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }, [user, loading])

  const bookmarks = snapshot.scope === getStorageScope() ? snapshot.bookmarks : getAllBookmarks()
  return { bookmarks, busy, error, reload, change }
}
