import { Button } from '@/components/ui/button'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import PageState from './PageState'
import { isPageResourceError, recoverPageResource } from '../lib/page-recovery'

/** Keep a recovery screen available even when routing or a provider crashes. */
export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; error: unknown }
> {
  state = { failed: false, error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面加载或渲染失败', error, info.componentStack)
    recoverPageResource(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const resourceFailed = isPageResourceError(this.state.error)
    return <PageState
      title={resourceFailed ? '页面资源加载失败' : '页面暂时无法显示'}
      description={resourceFailed
        ? '可能是网络中断或站点更新导致。请检查网络后重新加载页面。'
        : '页面出现了异常，请重新加载；如果仍无法打开，可以先返回首页。'}
      actions={<>
        <Button variant="default" type="button"  onClick={() => window.location.reload()}>重新加载</Button>
        <Button asChild variant="secondary"><a  href="/">返回首页</a></Button>
      </>}
    />
  }
}
