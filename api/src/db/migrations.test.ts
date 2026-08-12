import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/** 用 WASM PostgreSQL（pglite）验证迁移 SQL：无本地 PG 服务器也能保证语法与表结构正确。 */
describe('数据库迁移', () => {
  it('所有迁移按序执行成功，建出 26 张表', async () => {
    const db = new PGlite({ extensions: { pg_trgm } })
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    expect(files.length).toBeGreaterThan(0)

    for (const f of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8')
      await db.exec(sql) // 语法错误/依赖顺序错误会在此抛出
    }

    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const tables = rows.map((r) => r.tablename)
    const expected = [
      'users', 'user_sessions', 'user_avatars', 'login_failures', 'login_audit', 'invites', 'app_settings',
      'novels', 'chapters',
      'scrape_configs', 'scrape_sources', 'scrape_jobs', 'scrape_job_items', 'scrape_job_logs',
      'reading_progress', 'novel_covers', 'download_logs',
      'thoughts', 'novel_ratings', 'novel_comments', 'novel_comment_likes', 'novel_comment_reports',
      'user_bookmarks', 'user_bookshelf',
      'ai_generations', 'ai_usage', 'ai_tasks', 'api_keys',
    ]
    for (const t of expected) {
      expect(tables).toContain(t)
    }

    // 011：pg_trgm 可用时应建出小说搜索的 trigram 索引
    const { rows: trgmRows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_novels_%_trgm' ORDER BY indexname`,
    )
    expect(trgmRows.map((r) => r.indexname)).toEqual([
      'idx_novels_author_trgm',
      'idx_novels_description_trgm',
      'idx_novels_title_trgm',
    ])
  })

  it('011：pg_trgm 扩展不可用时迁移优雅降级（跳过索引不报错）', async () => {
    const db = new PGlite() // 不装载 pg_trgm
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8'))
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, '011_novel_search_trgm.sql'), 'utf8'))
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_novels_%_trgm'`,
    )
    expect(rows.length).toBe(0)
  })

  it('关键列类型正确（时间戳为 BIGINT、封面为 BYTEA）', async () => {
    const db = new PGlite()
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8'))

    const { rows } = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'created_at'`,
    )
    expect(rows[0]?.data_type).toBe('bigint')

    const { rows: coverRows } = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'novel_covers' AND column_name = 'data'`,
    )
    expect(coverRows[0]?.data_type).toBe('bytea')
  })

  it('部分唯一索引（举报待处理去重）创建成功', async () => {
    const db = new PGlite()
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, '001_init.sql'), 'utf8'))
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_comment_reports_open_once'`,
    )
    expect(rows.length).toBe(1)
  })
})
