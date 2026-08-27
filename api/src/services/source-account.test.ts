import { describe, expect, it } from 'vitest'
import { sourceAccountTestHelpers } from './source-account'

describe('PO18.tw source account helpers', () => {
  it('规范化浏览器复制的 Cookie，并保留带等号的值', () => {
    const { normalizeCookie } = sourceAccountTestHelpers
    expect(normalizeCookie('Cookie: PHPSESSID=abc==; theme=dark\nignored-header')).toBe('PHPSESSID=abc==; theme=dark')
    expect(normalizeCookie(' a=1; invalid; b=2 ')).toBe('a=1; b=2')
  })

  it('合并重定向过程中返回的 Set-Cookie，并以最新值覆盖旧值', () => {
    const { mergeCookies } = sourceAccountTestHelpers
    expect(mergeCookies('sid=old; keep=yes', ['sid=new; Path=/', 'fresh=value; HttpOnly'])).toBe('sid=new; keep=yes; fresh=value')
  })

  it('识别带隐藏字段和验证码的登录表单', () => {
    const { parseLoginForm } = sourceAccountTestHelpers
    const form = parseLoginForm(
      `<form action="/apps/login.php" method="post">
        <input type="hidden" name="token" value="a&amp;b">
        <input type="text" name="account">
        <input type="password" name="password">
        <input type="text" name="verifycode">
        <img class="captcha" src="/captcha.png">
      </form>`,
      'sid=abc',
    )
    expect(form).toMatchObject({
      action: 'https://members.po18.tw/apps/login.php',
      usernameField: 'account',
      passwordField: 'password',
      captchaField: 'verifycode',
      captchaUrl: 'https://members.po18.tw/captcha.png',
      cookie: 'sid=abc',
      hidden: { token: 'a&b' },
    })
  })

  it('可识别登录页和失败提示，避免把错误响应当作成功会话', () => {
    const { loginMarker, loginFailureMarker } = sourceAccountTestHelpers
    expect(loginMarker('<h1>會員登入</h1><input name="account"><input type="password" name="password">')).toBe(true)
    expect(loginFailureMarker('<p>帳號或密碼錯誤</p>')).toBe(true)
    expect(loginFailureMarker('<p>登入成功</p>')).toBe(false)
  })

  it('允许 PO18 与共用会员体系的 POPO 登录跳转，但不允许第三方域名', () => {
    const { assertPo18Url } = sourceAccountTestHelpers
    expect(assertPo18Url('https://members.po18.tw/apps/login.php').hostname).toBe('members.po18.tw')
    expect(assertPo18Url('https://www.popo.tw/').hostname).toBe('www.popo.tw')
    expect(() => assertPo18Url('https://example.com/')).toThrow('实际跳转到：example.com')
  })
})
