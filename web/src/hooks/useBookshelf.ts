/**
 * 书架 hook —— 本地缓存 + 服务端同步（由 novel.js initBookshelfButton 平移）。
 * 未登录：仅本地 localStorage；已登录：服务端权威 + 本地缓存镜像。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Novel } from '@shared/types'
import { bookshelfApi, getToken } from '../lib/api'
import { addToBookshelf, getStorageScope, isInBookshelf, removeFromBookshelf } from '../lib/storage'
import { useSession } from '../context/SessionContext'

export function useBookshelf(novelId: string | undefined) {
  const { user } = useSession()
  const [inShelf, setInShelf] = useState<boolean>(() => (novelId ? isInBookshelf(novelId) : false))
  const [synced, setSynced] = useState(false)
  const mutation = useRef(false)
  const revision = useRef(0)

  useEffect(() => {
    if (!novelId) return
    const seq = ++revision.current
    setSynced(false)
    setInShelf(isInBookshelf(novelId))
    if (!user) {
      setSynced(true)
      return
    }
    let cancelled = false
    const token = getToken()
    const scope = getStorageScope()
    void bookshelfApi
      .get()
      .then((data) => {
        if (cancelled || seq !== revision.current || token !== getToken() || scope !== getStorageScope()) return
        const favs = (data as { favorites?: Array<{ novelId: string }> }).favorites || []
        const saved = favs.some((item) => item.novelId === novelId)
        setInShelf(saved)
        if (saved) addToBookshelf({ id: novelId, title: '', author: '', chapterCount: 0 })
        else removeFromBookshelf(novelId)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSynced(true)
      })
    return () => {
      cancelled = true
    }
  }, [novelId, user])

  const toggle = useCallback(
    async (novel?: Pick<Novel, 'id' | 'title' | 'author' | 'chapterCount'>) => {
      if (!novelId || mutation.current) return
      const target = novel ? novel : ({ id: novelId, title: '', author: '', chapterCount: 0 } as Novel)
      const next = !inShelf
      const token = getToken()
      const scope = getStorageScope()
      if (token && scope === 'pending') return
      const seq = ++revision.current
      // 乐观更新
      setInShelf(next)
      if (next) addToBookshelf(target)
      else removeFromBookshelf(novelId)
      if (!user) return
      mutation.current = true
      try {
        if (next) await bookshelfApi.add(novelId)
        else await bookshelfApi.remove(novelId)
      } catch {
        if (token !== getToken() || scope !== getStorageScope() || seq !== revision.current) return
        // 回滚
        setInShelf(!next)
        if (next) removeFromBookshelf(novelId)
        else addToBookshelf(target)
      } finally {
        mutation.current = false
      }
    },
    [novelId, inShelf, user],
  )

  return { inShelf, toggle, synced }
}
