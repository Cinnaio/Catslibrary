import { describe, expect, it } from 'vitest'
import { assertPo18SessionResponse, cookieIsDeleted, Po18SessionExpiredError } from './po18-session-policy'

const url = 'https://www.po18.tw/books/123/articles'
const cookie = 'authtoken1=fixture; authtoken2=fixture'

describe('PO18 会话失效信号', () => {
  it.each(['https://members.po18.tw/apps/logout.php', 'https://members.po18.tw/apps/login.php', '/apps/logout.php'])('在跟随 %s 前中止', location => {
    expect(() => assertPo18SessionResponse(new Response(null, { status: 302, headers: { location } }), url, cookie)).toThrow(Po18SessionExpiredError)
  })

  it.each(['authtoken1=deleted; Max-Age=0; Path=/; Domain=.po18.tw', 'authtoken2=; expires=Thu, 01 Jan 1970 00:00:00 GMT'])('识别源站清除当前认证令牌：%s', value => {
    expect(() => assertPo18SessionResponse(new Response(null, { headers: { 'Set-Cookie': value } }), url, cookie)).toThrow(Po18SessionExpiredError)
  })

  it('同一响应中删除后重新签发，不误判正常令牌更新', () => {
    const headers = new Headers()
    headers.append('Set-Cookie', 'authtoken1=; Max-Age=0')
    headers.append('Set-Cookie', 'authtoken1=renewed; Max-Age=3600')
    expect(() => assertPo18SessionResponse(new Response(null, { headers }), url, cookie)).not.toThrow()
  })

  it.each([
    'theme=; Max-Age=0',
    'authtoken6=; Max-Age=0',
    'authtoken1=; Max-Age=0; Domain=example.com',
    'authtoken1=; Max-Age=0; Path=/unrelated',
  ])('非当前认证 Cookie 或不适用作用域不能停用会话：%s', value => {
    expect(() => assertPo18SessionResponse(new Response(null, { headers: { 'Set-Cookie': value } }), url, cookie)).not.toThrow()
  })

  it.each([403, 404, 429, 500])('HTTP %s 保持原本错误分类', status => {
    const response = new Response(null, { status, headers: { 'Set-Cookie': 'authtoken1=; Max-Age=0' } })
    expect(() => assertPo18SessionResponse(response, url, cookie)).not.toThrow()
  })

  it('其他站点和伪装域名不能失效 PO18 账号，普通翻页跳转不受影响', () => {
    const response = new Response(null, { status: 302, headers: { location: 'https://members.po18.tw/apps/logout.php' } })
    expect(() => assertPo18SessionResponse(response, 'https://po18.tw.evil.example/book', cookie)).not.toThrow()
    expect(() => assertPo18SessionResponse(new Response(null, { status: 302, headers: { location: '?page=2' } }), url, cookie)).not.toThrow()
  })

  it('Max-Age 优先于 Expires，能识别非 1970 年的过期日期', () => {
    expect(cookieIsDeleted('sid=old; Expires=Mon, 01 Jan 2001 00:00:00 GMT')).toBe(true)
    expect(cookieIsDeleted('sid=new; Max-Age=3600; Expires=Mon, 01 Jan 2001 00:00:00 GMT')).toBe(false)
    expect(cookieIsDeleted('sid=old; Max-Age=-1')).toBe(true)
  })
})
