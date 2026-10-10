import { ReauthenticationDialog } from './components/ReauthenticationDialog'
/**
 * 应用路由 —— 干净路径（/ /novel/:id /read/:novelId/:chapterId /bookshelf /profile /auth）。
 * Reader 用无页头布局（沉浸式）；/auth、/install、/admin 同为独立顶级路由，也不带站点页头：
 * 这三页都是「偏离正常浏览」的场景（登录、安装、后台），页头里的搜索、书架、内容模式
 * 在这里要么无意义、要么是死路，去掉后只留一条明确的出口。
 * 管理后台与安装向导按路由懒加载：读者不需要为它们（含 recharts 等重依赖）付出首屏体积。
 */
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import VisitTracker from './components/VisitTracker'
import RouteLoading from './components/RouteLoading'
import PageSeo from './components/PageSeo'
import SiteBrandingSync from './components/SiteBrandingSync'

const Install = lazy(() => import('./pages/Install'))
const Admin = lazy(() => import('./pages/admin/Admin'))
const Novel = lazy(() => import('./pages/Novel'))
const Reader = lazy(() => import('./pages/Reader'))
const Bookshelf = lazy(() => import('./pages/Bookshelf'))
const Profile = lazy(() => import('./pages/Profile'))
const Auth = lazy(() => import('./pages/Auth'))

export default function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <ReauthenticationDialog />
      <SiteBrandingSync />
      <VisitTracker />
      <PageSeo />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/novel/:id" element={<Novel />} />
          <Route path="/bookshelf" element={<Bookshelf />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="/read/:novelId/:chapterId" element={<Reader />} />
        {/* 无站点页头：登录页只保留一条出口，与门禁页、安装页一致。 */}
        <Route path="/auth" element={<Auth />} />
        <Route path="/install" element={<Install />} />
        <Route path="/admin/:tab?" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
