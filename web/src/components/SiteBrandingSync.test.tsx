import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SITE_BRANDING, type SiteBranding } from '@shared/site-settings'
const api = vi.hoisted(() => ({ publicBranding: vi.fn() }))
vi.mock('../lib/api', () => ({ siteSettingsApi: api, url: (path: string) => `/api${path}` }))
import SiteBrandingSync from './SiteBrandingSync'
import PageSeo from './PageSeo'
import { setSiteBranding, useSiteBranding } from '../lib/site-branding'
import { setPageSeo } from '../lib/seo'
function Brand() { const value = useSiteBranding(); return <span>{value.name}</span> }
beforeEach(() => { vi.resetAllMocks(); setSiteBranding(DEFAULT_SITE_BRANDING) })
describe('品牌同步边界', () => {
  it.each(['文字', '图片'])('旧读取不能覆盖刚保存的%s', async kind => {
    let resolve!: (value: SiteBranding) => void
    api.publicBranding.mockReturnValue(new Promise<SiteBranding>(done => { resolve = done }))
    render(<><SiteBrandingSync /><Brand /></>)
    act(() => setSiteBranding({ ...DEFAULT_SITE_BRANDING, name: '保存后的新品牌', logoUrl: kind === '图片' ? '/api/site-settings/assets/logo?v=new' : DEFAULT_SITE_BRANDING.logoUrl }))
    expect(screen.getByText('保存后的新品牌')).toBeInTheDocument()
    await act(async () => resolve({ ...DEFAULT_SITE_BRANDING, name: '旧品牌' }))
    expect(screen.queryByText('旧品牌')).not.toBeInTheDocument()
    expect(screen.getByText('保存后的新品牌')).toBeInTheDocument()
  })
  it('focus 读取中最新请求胜出，卸载后不应用响应', async () => {
    const pending: Array<(value: SiteBranding) => void> = []
    api.publicBranding.mockImplementation(() => new Promise<SiteBranding>(resolve => pending.push(resolve)))
    const { unmount } = render(<><SiteBrandingSync /><Brand /></>)
    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => pending[1]!({ ...DEFAULT_SITE_BRANDING, name: '最新品牌' }))
    await act(async () => pending[0]!({ ...DEFAULT_SITE_BRANDING, name: '旧品牌' }))
    expect(screen.getByText('最新品牌')).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('focus')))
    unmount()
    await act(async () => pending[2]!({ ...DEFAULT_SITE_BRANDING, name: '卸载后的响应' }))
    render(<Brand />)
    expect(screen.getByText('最新品牌')).toBeInTheDocument()
  })
  it('品牌描述更新不会覆盖已加载公开小说 SEO', async () => {
    const origin = document.createElement('meta'); origin.name = 'zhizhou-seo-origin'; origin.content = 'https://read.example.com'; document.head.append(origin)
    setPageSeo(true, '作品简介', '/novel/book')
    render(<MemoryRouter initialEntries={['/novel/book']}><PageSeo /></MemoryRouter>)
    act(() => setSiteBranding({ ...DEFAULT_SITE_BRANDING, description: '新的站点介绍' }))
    expect(document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toBe('index, follow')
    expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe('作品简介')
    expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe('https://read.example.com/novel/book')
    origin.remove()
  })
  it('首页默认描述仍会随品牌更新', async () => {
    render(<MemoryRouter><PageSeo /></MemoryRouter>)
    act(() => setSiteBranding({ ...DEFAULT_SITE_BRANDING, description: '新的站点介绍' }))
    await waitFor(() => expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe('新的站点介绍'))
  })
})
