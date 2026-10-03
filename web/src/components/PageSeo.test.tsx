import { StrictMode } from 'react'
import { cleanup, render, act } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import PageSeo from './PageSeo'
import { setPageSeo } from '../lib/seo'

afterEach(() => {
  cleanup()
  document.head.innerHTML = ''
})
const robots = () => document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content

describe('SPA SEO metadata', () => {
  it('preserves initial server indexability under StrictMode then resets on private navigation', async () => {
    document.head.innerHTML =
      '<meta name="zhizhou-seo-origin" content="https://read.example.com"><meta name="robots" content="index, follow"><link rel="canonical" href="https://read.example.com/novel/general">'
    const router = createMemoryRouter([{ path: '*', element: <PageSeo /> }], { initialEntries: ['/novel/general'] })
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    )
    expect(robots()).toBe('index, follow')
    await act(() => router.navigate('/bookshelf'))
    expect(robots()).toBe('noindex, follow')
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    await act(() => router.navigate('/'))
    expect(robots()).toBe('index, follow')
    await act(() => router.navigate('/?search=test'))
    expect(robots()).toBe('noindex, follow')
    await act(() => router.navigate('/novel/unknown'))
    expect(robots()).toBe('noindex, follow')
  })
  it('keeps static-only and development HTML excluded', () => {
    setPageSeo(true, '公开简介', '/')
    expect(robots()).toBe('noindex, follow')
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
  })
  it('updates loaded novel metadata safely and can revoke indexability', () => {
    document.head.innerHTML = '<meta name="zhizhou-seo-origin" content="https://read.example.com">'
    setPageSeo(true, '<script>简介</script>', '/novel/general')
    expect(robots()).toBe('index, follow')
    expect(document.querySelector('script')).toBeNull()
    setPageSeo(false)
    expect(robots()).toBe('noindex, follow')
  })
})
