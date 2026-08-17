/**
 * 应用路由 —— 干净路径（/ /novel/:id /read/:novelId/:chapterId /bookshelf /profile /auth）。
 * Reader 用无页头布局（沉浸式）；其余页面走 Layout。
 * 管理后台与安装向导按路由懒加载：读者不需要为它们（含 recharts 等重依赖）付出首屏体积。
 */
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Novel from './pages/Novel'
import Reader from './pages/Reader'
import Bookshelf from './pages/Bookshelf'
import Profile from './pages/Profile'
import Auth from './pages/Auth'
import VisitTracker from './components/VisitTracker'

const Install = lazy(() => import('./pages/Install'))
const Admin = lazy(() => import('./pages/admin/Admin'))

function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--color-text-secondary, #888)' }}>
      加载中…
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <VisitTracker />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/novel/:id" element={<Novel />} />
          <Route path="/bookshelf" element={<Bookshelf />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/auth" element={<Auth />} />
        </Route>
        <Route path="/read/:novelId/:chapterId" element={<Reader />} />
        <Route path="/install" element={<Install />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
