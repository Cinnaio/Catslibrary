import { Pool } from 'pg'
import { afterAll, beforeAll, expect, it, describe } from 'vitest'
import type { Db } from '../db/pool'
import { runMigrations } from '../db/migrate'
import { applyReadingData, previewReadingData } from './reading-data'
import type { LegacyReadingData } from '@shared/reading-data'

const url = process.env.BACKUP_READING_DATA_INTEGRATION_DATABASE_URL
describe.skipIf(!url)('真实 PostgreSQL 阅读数据恢复与并发保护', () => {
  let pool: Pool, writer: Pool, db: Db
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/backup_integration_reading_data') throw new Error('Requires dedicated reading data test database')
    pool = new Pool({ connectionString: url })
    writer = new Pool({ connectionString: url })
    db = pool as unknown as Db
    await runMigrations(db)
    await pool.query("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('reader','reader','test','test',1,1)")
    await pool.query("INSERT INTO novels(id,title,content_rating,created_at,updated_at) VALUES('n','作品','general',1,1),('new','恢复作品','general',1,1)")
    await pool.query(
      "INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES('a','n','第一章','正文',1,1),('z','n','第二章','正文',2,1),('new-c','new','新章','正文',1,1)",
    )
    await pool.query(
      "INSERT INTO user_bookmarks(id,user_id,novel_id,novel_title,chapter_id,chapter_title,note,created_at,updated_at) VALUES('a','reader','n','旧作品','a','旧章','原始备注',1,1),('z','reader','n','旧作品','z','旧章','原始备注',1,1)",
    )
  })
  afterAll(async () => {
    if (writer) await writer.end()
    if (pool) await pool.end()
  })
  it('另一连接在应用途中修改书签，整批回滚并保留并发新备注', async () => {
    const preview = await previewReadingData(db, 'reader', false)
    let injected = false
    const racing: Db = {
      ...db,
      query: db.query.bind(db),
      end: db.end.bind(db),
      connect: async () => {
        const client = await db.connect()
        return {
          release: () => client.release(),
          query: (async (sql: string, args?: unknown[]) => {
            if (!injected && sql.includes('UPDATE user_bookmarks b') && args?.[1] === 'z') {
              injected = true
              await writer.query("UPDATE user_bookmarks SET note='另一设备刚修改的备注',updated_at=2 WHERE id='z'")
            }
            return client.query(sql, args)
          }) as typeof client.query,
        }
      },
    }
    await expect(
      applyReadingData(racing, 'reader', false, { operationId: 'racing-repair', previewToken: preview.previewToken, expiresAt: preview.expiresAt }),
    ).rejects.toMatchObject({ status: 409 })
    expect(injected).toBe(true)
    expect((await pool.query("SELECT novel_title,chapter_title FROM user_bookmarks WHERE id='a'")).rows[0]).toEqual({
      novel_title: '旧作品',
      chapter_title: '旧章',
    })
    expect((await pool.query("SELECT note FROM user_bookmarks WHERE id='z'")).rows[0].note).toBe('另一设备刚修改的备注')
    expect((await pool.query('SELECT * FROM reading_data_operations')).rows).toHaveLength(0)
  })
  it('并发提交同一恢复最多落一份数据和回执，响应丢失后的重试返回原结果', async () => {
    const data: LegacyReadingData = {
      bookmarks: [{ novelId: 'new', chapterId: 'new-c', note: '旧书签备注' }],
      progress: [{ novelId: 'new', chapterId: 'new-c', scrollPercent: 0.5 }],
      bookshelf: [{ novelId: 'new' }],
    }
    const preview = await previewReadingData(db, 'reader', false, data)
    const request = { operationId: 'concurrent-restore', previewToken: preview.previewToken, expiresAt: preview.expiresAt, data }
    const outcomes = await Promise.allSettled([applyReadingData(db, 'reader', false, request), applyReadingData(db, 'reader', false, request)])
    const successful = outcomes.filter((r) => r.status === 'fulfilled')
    expect(successful.length).toBeGreaterThan(0)
    for (const result of outcomes) if (result.status === 'rejected') expect(result.reason.status).toBe(409)
    expect((await pool.query("SELECT * FROM user_bookmarks WHERE novel_id='new'")).rows).toHaveLength(1)
    expect((await pool.query("SELECT * FROM reading_progress WHERE novel_id='new'")).rows).toHaveLength(1)
    expect((await pool.query("SELECT * FROM user_bookshelf WHERE novel_id='new'")).rows).toHaveLength(1)
    expect((await pool.query("SELECT * FROM reading_data_operations WHERE operation_id='concurrent-restore'")).rows).toHaveLength(1)
    expect(await applyReadingData(db, 'reader', false, request)).toEqual((successful[0] as PromiseFulfilledResult<unknown>).value)
  })
})
