import { LoaderCircle } from 'lucide-react'

/** 路由资源加载时的轻量过渡；随真实加载结束卸载，不额外延长等待。 */
export default function RouteLoading() {
  return (
    <main className="route-loading" aria-busy="true">
      <div className="route-loading__status" role="status" aria-live="polite" aria-atomic="true">
        <LoaderCircle className="route-loading__indicator" strokeWidth={1.5} aria-hidden="true" />
        <p className="route-loading__title">正在加载</p>
        <p className="route-loading__hint">请稍候，内容即将呈现</p>
      </div>
    </main>
  )
}
