/** 标准页面布局：页头 + 内容区。 */
import { Outlet, useLocation } from 'react-router-dom'
import { Suspense, useState } from 'react'
import RouteLoading from './RouteLoading'
import { PageLayoutContext } from '../context/PageLayoutContext'
import WorkspaceShell from './workspace/WorkspaceShell'
import { MotionView } from './ui/motion'

export default function Layout() {
  const { pathname } = useLocation()
  const [standalone, setStandalone] = useState(false)
  return (
    <PageLayoutContext.Provider value={setStandalone}>
      <WorkspaceShell standalone={standalone}>
        <Suspense key={pathname} fallback={<RouteLoading embedded />}>
          <MotionView><Outlet /></MotionView>
        </Suspense>
      </WorkspaceShell>
    </PageLayoutContext.Provider>
  )
}
