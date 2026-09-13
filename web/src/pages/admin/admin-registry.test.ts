import { describe, expect, it } from 'vitest'
import { adminTabPath, getTabLabel, isAdminTab, NAV_GROUPS } from './admin-registry'

describe('admin registry routes', () => {
  it('识别有效后台模块并生成稳定地址', () => {
    expect(isAdminTab('dashboard')).toBe(true)
    expect(isAdminTab('content-policy')).toBe(true)
    expect(isAdminTab('missing')).toBe(false)
    expect(isAdminTab(undefined)).toBe(false)
    expect(adminTabPath('content-policy')).toBe('/admin/content-policy')
    expect(getTabLabel('novels')).toBe('小说管理')
  })

  it('将审核类型合并到审核队列，并让二级入口保持扁平', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    const moderation = items.find((item) => item.id === 'moderation')

    expect(moderation?.children?.map((child) => child.label)).toEqual(['审核队列', '安全策略'])
    expect(items.flatMap((item) => item.children || []).every((child) => !('group' in child))).toBe(true)
  })

  it('将发现小说入口收拢到抓取中心', () => {
    const scrape = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === 'scrape')

    expect(scrape?.children?.map((child) => child.label)).not.toContain('发现小说')
    expect(scrape?.children?.map((child) => child.label)).toContain('抓取中心')
  })
})
