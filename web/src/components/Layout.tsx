/** 标准页面布局：页头 + 内容区。 */
import { Outlet, useLocation } from 'react-router-dom'
import { Suspense, useState } from 'react'
import RouteLoading from './RouteLoading'
import { PageLayoutContext } from '../context/PageLayoutContext'
import SiteNotice from './SiteNotice'
import SiteHeader from './SiteHeader'

export default function Layout() {
  const { pathname } = useLocation()
  const [standalone, setStandalone] = useState(false)
  return (
    <PageLayoutContext.Provider value={setStandalone}>
      <Suspense key={pathname} fallback={<RouteLoading />}>
        {!standalone && <><SiteHeader /><SiteNotice /></>}
        <Outlet />
      </Suspense>
    </PageLayoutContext.Provider>
  )
}
