import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'

export type ExclusiveMenu = 'account' | 'theme'

const MENU_OPEN_EVENT = 'zhi-zhou:exclusive-menu-open'

interface MenuOpenDetail {
  menu: ExclusiveMenu
}

/**
 * 让分散在页头、管理壳和阅读器中的菜单保持互斥。
 * 使用文档级事件是为了不要求所有调用处共享同一个 React Provider。
 */
export function useExclusiveMenu(menu: ExclusiveMenu, setOpen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    function onMenuOpen(event: Event) {
      const detail = (event as CustomEvent<MenuOpenDetail>).detail
      if (detail?.menu && detail.menu !== menu) setOpen(false)
    }

    document.addEventListener(MENU_OPEN_EVENT, onMenuOpen)
    return () => document.removeEventListener(MENU_OPEN_EVENT, onMenuOpen)
  }, [menu, setOpen])

  return useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        document.dispatchEvent(new CustomEvent<MenuOpenDetail>(MENU_OPEN_EVENT, { detail: { menu } }))
      }
      setOpen(nextOpen)
    },
    [menu, setOpen],
  )
}
