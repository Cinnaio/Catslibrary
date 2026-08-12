/**
 * 页面标题 hook —— 统一「xxx — 知舟」格式，卸载时还原站点默认标题。
 * 传空（'' / null / undefined）时直接使用默认标题，适合数据未就绪阶段。
 */
import { useEffect } from 'react'

export const DEFAULT_DOC_TITLE = '知舟 — 小说阅读'

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} — 知舟` : DEFAULT_DOC_TITLE
  }, [title])

  // 卸载还原：路由切换时旧页 cleanup 先于新页 effect 执行，不会覆盖新页标题
  useEffect(() => {
    return () => {
      document.title = DEFAULT_DOC_TITLE
    }
  }, [])
}
