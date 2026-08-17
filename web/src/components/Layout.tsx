/** 标准页面布局：页头 + 内容区。 */
import { Outlet } from 'react-router-dom'
import SiteNotice from './SiteNotice'
import SiteHeader from './SiteHeader'

export default function Layout() {
  return (
    <>
      <SiteHeader />
      <SiteNotice />
      <Outlet />
    </>
  )
}
