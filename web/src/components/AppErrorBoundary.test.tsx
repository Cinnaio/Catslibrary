import { lazy, Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AppErrorBoundary from './AppErrorBoundary'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

it('shows recovery actions when a component crashes', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  function Broken(): never { throw new Error('render failed') }
  render(<AppErrorBoundary><Broken /></AppErrorBoundary>)
  expect(screen.getByRole('heading', { name: '页面暂时无法显示' })).toBeVisible()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
  expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
})

it('catches rejected lazy routes after automatic recovery has already been attempted', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStorage.setItem('zhi-zhou:page-recovery', String(Date.now()))
  const Broken = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/old.js')))
  render(<AppErrorBoundary><Suspense fallback="正在加载"><Broken /></Suspense></AppErrorBoundary>)
  expect(await screen.findByRole('heading', { name: '页面资源加载失败' })).toBeVisible()
  expect(screen.getByRole('button', { name: '重新加载' })).toBeVisible()
})
