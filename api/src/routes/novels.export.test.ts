import { parseTextImport } from '../services/book-import'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { hashToken } from '../services/auth'
import { loadConfig } from '../config'
import { exportFileName, exportNovels } from '../services/novel-export'

let t: TestDb
const tokens = { admin: 'export-admin-token', reader: 'export-reader-token' }
function request(body: unknown, role?: keyof typeof tokens) {
  return app.request('/api/novels/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
    },
    body: JSON.stringify(body),
  })
}
beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test/test'
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  const now = Date.now()
  for (const [role, token] of Object.entries(tokens)) {
    await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES($1,$1,$1,'unused','unused',$2,$2)", [
      role,
      now,
    ])
    await t.db.query('INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES($1,$2,$3,$4,$4)', [
      await hashToken(token, loadConfig().sessionHashSalt),
      role,
      now + 86400000,
      now,
    ])
  }
  for (const id of ['a', 'b', 'empty']) {
    await t.db.query("INSERT INTO novels(id,title,author,description,visibility,created_at,updated_at) VALUES($1,$2,'测试作者','这是简介','admin',$3,$3)", [
      id,
      id === 'empty' ? '无正文作品' : '../同名:书',
      now,
    ])
  }
  for (const [id, order, content] of [
    ['later', 2, '后章正文'],
    ['first', 1, '首章正文\n第二段'],
  ]) {
    await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,'a',$1,$2,$3,$4)", [id, content, order, now])
  }
  await t.db.query("INSERT INTO chapters(id,novel_id,title,content,created_at) VALUES('other','b','第二本章节','第二本正文',$1)", [now])
  await t.db.query("INSERT INTO ai_generations(id,novel_id,kind,result,status,created_at) VALUES('draft','a','continue','绝不能导出的未发布草稿','draft',$1)", [
    now,
  ])
})
afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

describe('管理员书籍导出', () => {
  it('匿名和普通读者均不能导出，包括私密书籍', async () => {
    expect((await request({ novelIds: ['a'] })).status).toBe(401)
    expect((await request({ novelIds: ['a'] }, 'reader')).status).toBe(403)
  })
  it('单本 TXT 含书籍信息，按顺序保留正文且排除 AI 草稿', async () => {
    const res = await request({ novelIds: ['a'] }, 'admin')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    expect(decodeURIComponent(res.headers.get('Content-Disposition')!)).toContain('同名_书.txt')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([239, 187, 191])
    const text = strFromU8(bytes)
    for (const part of ['测试作者', '这是简介', '首章正文\r\n    第二段', '后章正文']) expect(text).toContain(part)
    expect(text.indexOf('首章正文')).toBeLessThan(text.indexOf('后章正文'))
    expect(text).not.toContain('未发布草稿')
    expect(text).not.toContain('第二本正文')
  })
  it('批量 ZIP 按所选顺序包含独立 TXT，同名作品不覆盖且目录安全', async () => {
    const res = await request({ novelIds: ['b', 'a', 'b'] }, 'admin')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const names = Object.keys(entries)
    expect(names).toHaveLength(2)
    expect(names.every((name) => name.split('/').length === 2 && !name.includes('..') && !name.includes('\\') && name.endsWith('/正文.txt'))).toBe(true)
    expect(strFromU8(entries[names[0]!]!)).toContain('第二本正文')
    expect(strFromU8(entries[names[1]!]!)).toContain('首章正文')
  })
  it('批量只选一本仍返回 ZIP；无章节作品保留书籍信息', async () => {
    const res = await request({ novelIds: ['empty'], archive: true }, 'admin')
    expect(res.status).toBe(200)
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(entries)).toHaveLength(1)
    expect(strFromU8(Object.values(entries)[0]!)).toContain('无正文作品')
  })
  it('AI 续写经真实发布接口进入目录后，TXT 和 ZIP 都包含该章且不重复', async () => {
    await t.db.query("INSERT INTO novels(id,title,author,created_at,updated_at) VALUES('ai-export','AI续写导出测试','作者',1,1)")
    await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('ai-base','ai-export','原作章节','原作正文哨兵',1,1)")
    await t.db.query(
      "INSERT INTO ai_generations(id,novel_id,kind,result,status,params_json,created_at) VALUES('ai-export-draft','ai-export','continue','续写正文哨兵','draft',$1,2)",
      [JSON.stringify({ draftTitle: '续写章节', taskId: 'task-export' })],
    )
    const before = await request({ novelIds: ['ai-export'] }, 'admin')
    expect(await before.text()).not.toContain('续写正文哨兵')
    const published = await app.request('/api/ai/writing/drafts/ai-export-draft/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
      body: JSON.stringify({ novelId: 'ai-export' }),
    })
    expect(published.status).toBe(200)
    const txt = await request({ novelIds: ['ai-export'] }, 'admin')
    const text = await txt.text()
    expect(text).toContain('续写章节')
    expect(text.match(/续写正文哨兵/g)).toHaveLength(1)
    expect(text.indexOf('原作正文哨兵')).toBeLessThan(text.indexOf('续写正文哨兵'))
    const zipped = await request({ novelIds: ['ai-export', 'empty'], archive: true }, 'admin')
    const entries = unzipSync(new Uint8Array(await zipped.arrayBuffer()))
    expect(strFromU8(Object.values(entries)[0]!)).toContain('续写正文哨兵')
  })
  it('导出后重导保留无编号 AI 标题和正文中的伪章节行', async () => {
    await t.db.query(
      "INSERT INTO novels(id,title,author,description,created_at,updated_at) VALUES('roundtrip','往返书','作者','两行简介' || chr(10) || '第二行',1,1)",
    )
    for (const [index, title, content] of [
      [1, '第1章 原作', '原作正文。\n\n第九章 正文中的引文\n这行仍在原作正文内。'],
      [2, '新都夜话', '续写第一段。\n\n续写第二段。'],
      [3, '夜火照新宫', '另一章续写。'],
    ] as const)
      await t.db.query("INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,'roundtrip',$2,$3,$4,1)", [
        `rt-${index}`,
        title,
        content,
        index,
      ])
    const res = await request({ novelIds: ['roundtrip'] }, 'admin')
    const parsed = parseTextImport(await res.text(), '往返书.txt')
    expect(parsed.title).toBe('往返书')
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual(['第1章 原作', '新都夜话', '夜火照新宫'])
    expect(parsed.chapters[0]!.content).toContain('第九章 正文中的引文')
    expect(parsed.chapters[1]!.content).toBe('续写第一段。\n\n续写第二段。')
  })
  it('含封面书籍包仅附当前本地封面，缺失与通用封面提供说明', async () => {
    const cover = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    await t.db.query("INSERT INTO novel_covers(novel_id,data,content_type,source,updated_at) VALUES('b',$1,'image/png','upload',1)", [cover])
    await t.db.query("INSERT INTO novel_covers(novel_id,data,content_type,source,updated_at) VALUES('empty',$1,'image/png','default',1)", [cover])
    const response = await request({ novelIds: ['b', 'a', 'empty'], includeCover: true }, 'admin')
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
    const coverName = Object.keys(files).find((name) => name.endsWith('/封面.png'))!
    expect(Array.from(files[coverName]!)).toEqual(Array.from(cover))
    expect(Object.keys(files).filter((name) => name.includes('/封面.'))).toHaveLength(1)
    expect(Object.keys(files).filter((name) => name.endsWith('/封面说明.txt'))).toHaveLength(2)
    expect(Object.keys(files).filter((name) => name.endsWith('/正文.txt'))).toHaveLength(3)
  })
  it('单本含封面选项返回 ZIP，普通 TXT 不附封面', async () => {
    const packaged = await request({ novelIds: ['b'], includeCover: true }, 'admin')
    expect(packaged.headers.get('Content-Type')).toBe('application/zip')
    expect(Object.keys(unzipSync(new Uint8Array(await packaged.arrayBuffer()))).some((name) => name.endsWith('/封面.png'))).toBe(true)
    const plain = await request({ novelIds: ['b'] }, 'admin')
    expect(plain.headers.get('Content-Type')).toContain('text/plain')
  })
  it('所选有不存在作品时整体失败，避免缺书的成功下载', async () => {
    expect((await request({ novelIds: ['a', 'missing'] }, 'admin')).status).toBe(404)
  })
  it.each([
    null,
    {},
    { novelIds: [] },
    { novelIds: [1] },
    { novelIds: ['a'], archive: 'yes' },
    { novelIds: ['a'], includeCover: 'yes' },
    { novelIds: Array(101).fill('a') },
  ])('拒绝非法导出范围 %j', async (body) => {
    expect((await request(body, 'admin')).status).toBe(422)
  })
  it('正文超过容量上限时在读取整章内容之前拒绝导出', async () => {
    let contentRead = false
    const query = async (sql: string) => {
      if (sql.startsWith('SELECT id, title')) return { rows: [{ id: 'a', title: '大书', author: '', description: '' }], rowCount: 1 }
      if (sql.includes('SUM(octet_length')) return { rows: [{ bytes: String(65 * 1024 * 1024) }], rowCount: 1 }
      if (sql.startsWith('SELECT title, content')) contentRead = true
      return { rows: [], rowCount: 0 }
    }
    const db = { connect: async () => ({ query, release() {} }) } as unknown as TestDb['db']
    await expect(exportNovels(db, ['a'], false)).rejects.toMatchObject({ status: 413 })
    expect(contentRead).toBe(false)
  })
  it('文件名处理 Windows 保留名和路径字符', () => {
    expect(exportFileName('CON')).toBe('_CON')
    expect(exportFileName('../a/b\\c:*?')).not.toMatch(/[\/\\:*?]/)
  })
})
