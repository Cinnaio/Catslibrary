import { describe, expect, it } from 'vitest'
import { adminTabPath, getTabLabel, isAdminTab } from './admin-registry'

describe('admin registry routes', () => {
  it('识别有效后台模块并生成稳定地址', () => {
    expect(isAdminTab('dashboard')).toBe(true)
    expect(isAdminTab('content-policy')).toBe(true)
    expect(isAdminTab('missing')).toBe(false)
    expect(isAdminTab(undefined)).toBe(false)
    expect(adminTabPath('content-policy')).toBe('/admin/content-policy')
    expect(getTabLabel('novels')).toBe('小说管理')
  })
})
