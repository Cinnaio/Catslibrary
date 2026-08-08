/**
 * 应用路由 —— 干净路径（/ /novel/:id /read/:novelId/:chapterId /bookshelf /profile /auth）。
 * Reader 用无页头布局（沉浸式）；其余页面走 Layout。
 */
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Novel from './pages/Novel'
import Reader from './pages/Reader'
import Bookshelf from './pages/Bookshelf'
import Profile from './pages/Profile'
import Auth from './pages/Auth'
import Install from './pages/Install'
import Admin from './pages/admin/Admin'

export default function App() {
  return (
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
  )
}
