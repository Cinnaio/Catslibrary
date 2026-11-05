import { describe, expect, it } from 'vitest'
import { adminTabPath, getAdminViewLabel, getTabLabel, isAdminTab, NAV_GROUPS } from './admin-registry'
import { getSiteSettingsView } from './site-settings-views'

describe('admin registry routes', () => {
  it('站点设置提供品牌、内容安全、验证、模型、参数与 Passkey 稳定入口', () => {
    expect(isAdminTab('site-settings')).toBe(true)
    const settings = NAV_GROUPS.flatMap(group => group.items).find(item => item.id === 'site-settings')
    expect(settings?.children?.map(child => child.to)).toEqual(['/admin/site-settings?view=branding', '/admin/site-settings?view=content-policy', '/admin/site-settings?view=security', '/admin/site-settings?view=passkey', '/admin/ai?sub=config', '/admin/ai?sub=params'])
    expect(getAdminViewLabel('site-settings', '?view=content-policy')).toBe('内容安全')
    expect(getSiteSettingsView('/admin/ai', '?sub=config&keep=1')).toBe('config')
    expect(getSiteSettingsView('/admin/ai', '?sub=params&group=writing')).toBe('params')
    expect(getSiteSettingsView('/admin/ai', '', 'params')).toBe('params')
    expect(getSiteSettingsView('/admin/ai', '?sub=writing', 'config')).toBeNull()
  })
  it('站点运营导航只保留流量分析', () => {
    const operations = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === 'site-operations')
    expect(operations?.children?.map((child) => ({ label: child.label, to: child.to }))).toEqual([
      { label: '流量分析', to: '/admin/site-operations?view=traffic' },
    ])
  })
  it('识别有效后台模块并生成稳定地址', () => {
    expect(isAdminTab('dashboard')).toBe(true)
    expect(isAdminTab('content-policy')).toBe(true)
    expect(isAdminTab('content-ratings')).toBe(true)
    expect(isAdminTab('missing')).toBe(false)
    expect(isAdminTab(undefined)).toBe(false)
    expect(adminTabPath('content-policy')).toBe('/admin/content-policy')
    expect(getTabLabel('novels')).toBe('作品库')
    expect(getTabLabel('content-ratings')).toBe('分级管理')
  })

  it('将审核类型合并到审核队列，并让二级入口保持扁平', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    const moderation = items.find((item) => item.id === 'moderation')

    expect(moderation?.children?.map((child) => child.label)).toEqual(['审核队列', '分级管理'])
    expect(items.flatMap((item) => item.children || []).every((child) => !('group' in child))).toBe(true)
  })

  it('将发现小说入口收拢到抓取中心', () => {
    const scrape = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.id === 'scrape')

    expect(scrape?.children?.map((child) => child.label)).not.toContain('发现小说')
    expect(scrape?.children?.map((child) => child.label)).toContain('抓取中心')
  })
  it('将监控入口收拢为任务中心和调用与用量', () => {
    const group = NAV_GROUPS.find((item) => item.label === '运行')
    expect(group?.items.map((item) => item.label)).toEqual(['任务中心', '调用与用量', '书源与追更'])
    const children = NAV_GROUPS.flatMap((item) => item.items.flatMap((entry) => entry.children || []))
    for (const id of ['ai-tasks', 'ai-usage', 'ai-audit', 'jobs']) expect(children.map((item) => item.id)).not.toContain(id)
    expect(isAdminTab('tasks')).toBe(true)
    expect(isAdminTab('calls')).toBe(true)
    expect(isAdminTab('source-analytics')).toBe(true)
    expect(isAdminTab('jobs')).toBe(true)
  })
})
