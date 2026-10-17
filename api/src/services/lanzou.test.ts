import { describe, expect, it, vi } from 'vitest'
import { assertBookBytes, downloadLanzouFile, fileIdentity, normalizeLanzouFolderUrl, scanLanzouFolder } from './lanzou'

const page = (fid: string, children = '') =>
  `<title>10月</title>${children}<script>var stamp='1234567890';var secret='abc';$.ajax({url:'/filemoreajax.php?file=${fid}',data:{'lx':2,'fid':${fid},'uid':'1','puid':'x','t':stamp,'k':secret}})</script>`
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
const root = 'https://dudu88.lanzov.com/b002w85o2f'
describe('蓝奏目录与下载', () => {
  it('只接受明确的 HTTPS 蓝奏目录，移除分享跟踪参数', () => {
    expect(normalizeLanzouFolderUrl(root + '?cp=share')).toBe(root)
    for (const url of [
      'http://dudu88.lanzov.com/b123',
      'https://lanzov.com.evil.test/b123',
      'https://user:pass@lanzov.com/b123',
      'https://127.0.0.1/b123',
      'https://lanzov.com/i123',
      'https://lanzov.com:8000/b123',
    ])
      expect(() => normalizeLanzouFolderUrl(url)).toThrow()
  })
  it('提取版本标记、完整书名和作者，不合并不同副标题', () => {
    expect(fileIdentity('[更255] 圈宠（上-虐） 作者：尘星末位.txt')).toEqual({ title: '圈宠(上-虐)', author: '尘星末位', revision: 255 })
    expect(fileIdentity('【完结42+番外】山雨 作者：作者.epub')).toEqual({ title: '山雨', author: '作者', revision: null })
  })
  it('遍历日期子目录、翻页并排除推广项和非书籍文件', async () => {
    const child = '/b1016'
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === root) return bytes(page('1', `<a href="${child}" class="mlink"><div class="filename">1016<div></div></div></a>`))
      if (url === new URL(child, root).href) return bytes(page('2'))
      const body = new URLSearchParams(String(init?.body))
      if (body.get('fid') === '1') return bytes({ zt: 2 })
      if (body.get('pg') === '1')
        return bytes({
          zt: 1,
          text: Array.from({ length: 50 }, (_, i) => ({
            id: `iA${i}`,
            t: i === 0 ? 1 : 0,
            name_all: i === 1 ? 'image.png' : `[更2] 山雨${i} 作者：甲.txt`,
            size: '1 M',
          })),
        })
      return bytes({ zt: 1, text: [{ id: 'iLast', name_all: '[更3] 山雨49 作者：甲.txt', size: '2 M' }] })
    })
    const files = await scanLanzouFolder(root, 'secret', request)
    expect(files).toHaveLength(49)
    expect(files.at(-1)).toMatchObject({ folder: '1016', revision: 3, title: '山雨49', author: '甲' })
    expect(request.mock.calls.filter(([, init]) => String(init?.body).includes('pg=2'))).toHaveLength(1)
    expect(String(request.mock.calls.at(-1)?.[1]?.body)).toContain('pwd=secret')
  })
  it('中途分页失败不返回半份目录', async () => {
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init) return bytes(page('1'))
      if (new URLSearchParams(String(init.body)).get('pg') === '1')
        return bytes({ zt: 1, text: Array.from({ length: 50 }, (_, i) => ({ id: `iA${i}`, name_all: `山雨${i}.txt` })) })
      return bytes({ zt: 3 })
    })
    await expect(scanLanzouFolder(root, '', request)).rejects.toThrow('读取失败')
  })
  it('拒绝浏览器验证页、空文件和伪 EPUB', () => {
    for (const content of ['<html><script>var arg1="x"</script></html>', '<!DOCTYPE HTML><body>系统发现您的网络异常</body>', ''])
      expect(() => assertBookBytes(bytes(content), '山雨.txt')).toThrow()
    expect(() => assertBookBytes(bytes('不是压缩包'), '山雨.epub')).toThrow()
    expect(() => assertBookBytes(bytes('第1章 山雨\n正文'), '山雨.txt')).not.toThrow()
  })
  it('子目录翻页失败时只返回完整目录，明确记录缺口', async () => {
    const warnings: string[] = []
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init) {
        if (url === root)
          return bytes(
            page('1', '<a href="/bBad"><div class="filename">1015<div></div></div></a><a href="/bGood"><div class="filename">1016<div></div></div></a>'),
          )
        return bytes(page(url.includes('Bad') ? '2' : '3'))
      }
      const data = new URLSearchParams(String(init.body))
      if (data.get('fid') === '1') return bytes({ zt: 2 })
      if (data.get('fid') === '3') return bytes({ zt: 1, text: [{ id: 'iGood', name_all: '山雨.txt' }] })
      if (data.get('pg') === '1') return bytes({ zt: 1, text: Array.from({ length: 50 }, (_, i) => ({ id: 'iBad' + i, name_all: '错误半页' + i + '.txt' })) })
      return bytes({ zt: 4, info: '请刷新' })
    })
    const files = await scanLanzouFolder(root, '', request, warnings)
    expect(files.map((f) => f.title)).toEqual(['山雨'])
    expect(warnings).toEqual(['1015'])
  })
  it('解析分享页、iframe 与下载响应，验证页明确要求手动接续', async () => {
    const file = { key: 'key', url: 'https://dudu88.lanzov.com/iFile', name: '山雨.txt', folder: '1016', size: '1 M', title: '山雨', author: '甲', revision: 2 }
    let content = '<html>验证页</html>'
    const request = vi.fn(async (url: string) => {
      if (url === file.url) return bytes('<iframe src="/fn?key=1"></iframe>')
      if (url.includes('/fn?')) return bytes("var domain1='https://apifile.woozooo.com/ajaxfile.php?file=1';var wp_sign='sign';var ajaxdata='data';")
      if (url.includes('ajaxfile.php')) return bytes({ zt: 1, dom: 'https://developer4.lanrar.com', url: 'token' })
      return bytes(content)
    })
    await expect(downloadLanzouFile(file, request)).rejects.toMatchObject({ code: 'manual' })
    content = '第1章 山雨\n正文'
    expect(new TextDecoder().decode(await downloadLanzouFile(file, request))).toBe(content)
  })
})
