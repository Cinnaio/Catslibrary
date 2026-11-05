import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.WEB_URL || 'http://localhost:5173'
const source = await readFile(new URL('../web/src/pages/admin/ai/AiSettingsPanels.test.tsx', import.meta.url), 'utf8')
const fixture = JSON.parse(source.match(/const settings: AiSettings = (\{[\s\S]*?\n\})/)[1]
  .replace(/\b([A-Za-z][A-Za-z0-9]*):/g, '"$1":').replaceAll("'", '"').replace(/,\s*([}\]])/g, '$1'))
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' })
try {
  for (const [width, theme, motion] of [[1440, 'light', 'no-preference'], [900, 'dark', 'no-preference'], [700, 'light', 'no-preference'], [320, 'dark', 'reduce']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: motion })
    await context.addInitScript(theme => {
      localStorage.setItem('user_session_marker', 'isolated-settings-fixture')
      localStorage.setItem('theme', theme)
    }, theme)
    let settings = { ...fixture }
    const reads = [], writes = [], errors = []
    const branding = { name: '测试书库', tagline: '安静阅读', homeTitle: '测试书库', description: '隔离测试说明', logoUrl: '/images/logo.png', faviconUrl: '/images/logo.png' }
    const turnstile = { siteKey: 'fixture-public-key', hostnames: ['read.example.com'], secretSet: true, configured: true, encryptionReady: true, secretReadable: true, sources: { siteKey: 'database', secret: 'database', hostnames: 'database' } }
    const passkey = { enabled: true, registrationEnabled: true, rpName: '测试书库', rpId: 'localhost', origins: ['http://localhost:5173'], configured: true, userVerification: 'required', sources: { rpId: 'default', origins: 'default' } }
    const providerConfig = { baseUrl: 'https://example.test/v1', model: 'fixture-model', hasApiKey: true }
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (request.method() === 'POST' && ['/api/content-policy/refresh', '/api/site/visits'].includes(path)) {
        await route.fulfill({ json: { ok: true } })
        return
      }
      let data = {}
      if (request.method() === 'GET') reads.push(path)
      else {
        writes.push({ path, body: request.postDataJSON() })
        assert.equal(path, '/api/ai/settings', 'Unexpected write intercepted')
        assert.equal(request.method(), 'PUT')
        settings = { ...settings, ...request.postDataJSON() }
      }
      if (path === '/api/auth/me') data = { user: { id: 'fixture', username: 'admin', role: 'admin', status: 'active' } }
      else if (path === '/api/site-settings' || path === '/api/admin/site-settings/branding') data = branding
      else if (path.endsWith('/turnstile')) data = turnstile
      else if (path.endsWith('/passkey')) data = passkey
      else if (path === '/api/admin/content-policy' || path === '/api/content-policy') data = { adultContentEnabled: true, turnstileConfigured: true }
      else if (path === '/api/ai/settings') data = { settings, provider: null, imageProvider: null, providerConfig, imageProviderConfig: providerConfig }
      else if (path === '/api/ai/usage') data = { today: { calls: 0, promptTokens: 0, completionTokens: 0, costMillicents: 0 }, last30d: { calls: 0, promptTokens: 0, completionTokens: 0, costMillicents: 0 } }
      else if (path.includes('presets')) data = { presets: [] }
      await route.fulfill({ json: data })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/admin/site-settings?view=branding&keep=fixture#settings`)
    await page.getByLabel('站点名称', { exact: true }).fill('站点信息草稿')
    assert.ok(!reads.includes('/api/admin/site-settings/turnstile'))
    assert.ok(!reads.includes('/api/admin/site-settings/passkey'))
    assert.ok(!reads.includes('/api/ai/settings'))
    const navigation = page.getByRole('tablist', { name: '站点设置视图切换' })
    assert.deepEqual(await navigation.getByRole('tab').allTextContents(), ['站点信息', '内容安全', '安全验证', 'Passkey', '模型与服务', '创作参数'])
    await navigation.evaluate(element => { window.settingsNavigation = element })
    async function switchTo(label) {
      await navigation.getByRole('tab', { name: label, exact: true }).click()
      await page.waitForFunction(label => {
        const list = document.querySelector('[aria-label="站点设置视图切换"]')
        const active = list?.querySelector('[data-state="active"]'), indicator = list?.querySelector('[data-slot="tabs-indicator"]')
        if (!active || !indicator || active.textContent !== label) return false
        const target = active.getBoundingClientRect(), actual = indicator.getBoundingClientRect()
        return Math.abs(target.x - actual.x) <= 1 && Math.abs(target.y - actual.y) <= 1 && Math.abs(target.width - actual.width) <= 1
      }, label)
      assert.ok(await navigation.evaluate(element => element === window.settingsNavigation), 'Navigation was remounted')
      const position = await navigation.evaluate(element => {
        const active = element.querySelector('[data-state="active"]'), indicator = element.querySelector('[data-slot="tabs-indicator"]')
        const target = active.getBoundingClientRect(), actual = indicator.getBoundingClientRect()
        return { dx: Math.abs(target.x - actual.x), dy: Math.abs(target.y - actual.y), dw: Math.abs(target.width - actual.width) }
      })
      assert.ok(position.dx <= 1 && position.dy <= 1 && position.dw <= 1, `Indicator mismatch: ${JSON.stringify(position)}`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows horizontally')
      assert.equal(new URL(page.url()).searchParams.get('keep'), 'fixture')
      assert.equal(new URL(page.url()).hash, '#settings')
    }
    await switchTo('安全验证')
    await page.getByLabel('Site Key', { exact: true }).fill('verification-draft')
    await switchTo('Passkey')
    await page.getByLabel('Passkey 显示名称').fill('凭据名称草稿')
    await page.getByRole('switch', { name: /启用 Passkey 登录/ }).click()
    await page.getByText('已保存状态：已开启 Passkey 登录。', { exact: true }).waitFor()
    await switchTo('模型与服务')
    assert.equal(new URL(page.url()).pathname, '/admin/ai')
    assert.equal(new URL(page.url()).searchParams.get('sub'), 'config')
    try {
      await page.getByLabel('模型', { exact: true }).fill('draft-model', { timeout: 10000 })
    } catch (error) {
      console.error('Settings browser state:', page.url(), errors, await navigation.getByRole('tab').evaluateAll(tabs => tabs.map(tab => ({ label: tab.textContent, selected: tab.getAttribute('aria-selected') }))))
      throw error
    }
    await switchTo('创作参数')
    await page.locator('#recap-tokens').fill('600')
    await page.getByRole('button', { name: '保存所有参数', exact: true }).click()
    await page.getByRole('button', { name: '保存所有参数', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.ai-params-panel button[type="submit"]')?.disabled)
    assert.deepEqual(writes, [{ path: '/api/ai/settings', body: { recapMaxTokens: 600 } }])
    await switchTo('模型与服务')
    assert.equal(await page.getByLabel('模型', { exact: true }).inputValue(), 'draft-model')
    await switchTo('内容安全')
    assert.equal(await page.getByRole('region', { name: 'AI 配置保存', exact: true }).count(), 0)
    await switchTo('站点信息')
    assert.equal(await page.getByLabel('站点名称', { exact: true }).inputValue(), '站点信息草稿')
    await page.goBack()
    await page.waitForFunction(() => document.querySelector('[aria-label="站点设置视图切换"] [data-state="active"]')?.textContent === '内容安全')
    assert.equal(await navigation.getByRole('tab', { name: '内容安全', exact: true }).getAttribute('aria-selected'), 'true')
    await switchTo('安全验证')
    assert.equal(await page.getByLabel('Site Key', { exact: true }).inputValue(), 'verification-draft')
    await switchTo('Passkey')
    assert.equal(await page.getByLabel('Passkey 显示名称').inputValue(), '凭据名称草稿')
    await navigation.getByRole('tab', { name: 'Passkey', exact: true }).focus()
    await page.keyboard.press('End')
    await page.waitForFunction(() => document.activeElement?.textContent === '创作参数')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('[aria-label="站点设置视图切换"] [data-state="active"]')?.textContent === '创作参数')
    assert.equal(await navigation.getByRole('tab', { name: '创作参数', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('#recap-tokens').inputValue(), '600')
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px ${theme} ${motion}: six views, stable navigation, aligned slider, independent reads, retained drafts, partial save, history and keyboard`)
    await context.close()
  }
} finally {
  await browser.close()
}
