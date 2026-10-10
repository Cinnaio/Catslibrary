/** 标准页面布局：页头 + 内容区。 */
import { Outlet } from 'react-router-dom'
import { Suspense, useState } from 'react'
import RouteLoading from './RouteLoading'
import { PageLayoutContext } from '../context/PageLayoutContext'
import SiteNotice from './SiteNotice'
import SiteHeader from './SiteHeader'

export default function Layout() {
  const [standalone, setStandalone] = useState(false)
  return (
    <PageLayoutContext.Provider value={setStandalone}>
      {!standalone && <><SiteHeader /><SiteNotice /></>}
      <Suspense fallback={<RouteLoading embedded />}>
        <Outlet />
      </Suspense>
    </PageLayoutContext.Provider>
  )
}
