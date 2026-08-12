/**
 * 书架 hook —— 本地缓存 + 服务端同步（由 novel.js initBookshelfButton 平移）。
 * 未登录：仅本地 localStorage；已登录：服务端权威 + 本地缓存镜像。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Novel } from '@shared/types'
import { bookshelfApi } from '../lib/api'
import { addToBookshelf, isInBookshelf, removeFromBookshelf } from '../lib/storage'
import { useSession } from '../context/SessionContext'

export function useBookshelf(novelId: string | undefined) {
  const { user } = useSession()
  const [inShelf, setInShelf] = useState<boolean>(() => (novelId ? isInBookshelf(novelId) : false))
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    if (!novelId) return
    setInShelf(isInBookshelf(novelId))
    if (!user) {
      setSynced(true)
      return
    }
    let cancelled = false
    void bookshelfApi
      .get()
      .then((data) => {
        if (cancelled) return
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
      if (!novelId) return
      const target = novel ? novel : ({ id: novelId, title: '', author: '', chapterCount: 0 } as Novel)
      const next = !inShelf
      // 乐观更新
      setInShelf(next)
      if (next) addToBookshelf(target)
      else removeFromBookshelf(novelId)
      if (!user) return
      try {
        if (next) await bookshelfApi.add(novelId)
        else await bookshelfApi.remove(novelId)
      } catch {
        // 回滚
        setInShelf(!next)
        if (next) removeFromBookshelf(novelId)
        else addToBookshelf(target)
      }
    },
    [novelId, inShelf, user],
  )

  return { inShelf, toggle, synced }
}
