/**
 * /api/setup/* 安装向导测试（pglite 端到端 + buildDatabaseUrl 单测）。
 * 说明：database 的成功路径依赖真实 pg.Pool 外连，不在此覆盖（见验证步骤）；
 * 这里覆盖三端点门禁、字段校验与连接串组装。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { buildDatabaseUrl } from './setup'

let t: TestDb
let tmpDataDir: string

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  // 运行时配置写入重定向到临时目录，避免污染仓库 data/
  tmpDataDir = mkdtempSync(path.join(tmpdir(), 'zz-setup-'))
  process.env.RUNTIME_CONFIG_DIR = tmpDataDir
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.RUNTIME_CONFIG_DIR
  rmSync(tmpDataDir, { recursive: true, force: true })
  await t.close()
})

async function req(pathname: string, init?: RequestInit) {
  return app.request(pathname, init)
}
function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

describe('buildDatabaseUrl 连接串组装', () => {
  it('常规字段', () => {
    const r = buildDatabaseUrl({ host: 'db.local', port: '5433', user: 'app', password: 'secret', database: 'zhi_zhou' })
    expect(r).toEqual({ url: 'postgres://app:secret@db.local:5433/zhi_zhou' })
  })
  it('特殊字符 percent-encode', () => {
    const r = buildDatabaseUrl({ host: 'h', port: '5432', user: 'u@x', password: 'p@ss:w/rd#1', database: 'db' })
    expect(r).toEqual({ url: 'postgres://u%40x:p%40ss%3Aw%2Frd%231@h:5432/db' })
  })
  it('无密码省略冒号', () => {
    const r = buildDatabaseUrl({ host: 'h', port: '5432', user: 'u', password: '', database: 'db' })
    expect(r).toEqual({ url: 'postgres://u@h:5432/db' })
  })
  it('SSL 追加 sslmode=require', () => {
    const r = buildDatabaseUrl({ host: 'h', port: '5432', user: 'u', password: 'p', database: 'db', ssl: true })
    expect(r).toEqual({ url: 'postgres://u:p@h:5432/db?sslmode=require' })
  })
  it('IPv6 主机加方括号', () => {
    const r = buildDatabaseUrl({ host: '::1', port: '5432', user: 'u', password: 'p', database: 'db' })
    expect(r).toEqual({ url: 'postgres://u:p@[::1]:5432/db' })
  })
  it('字段校验：缺主机/坏端口/缺用户/缺库名', () => {
    expect(buildDatabaseUrl({ host: '', port: '5432', user: 'u', password: '', database: 'db' })).toHaveProperty('error')
    expect(buildDatabaseUrl({ host: 'h', port: '99999', user: 'u', password: '', database: 'db' })).toHaveProperty('error')
    expect(buildDatabaseUrl({ host: 'h', port: '5432', user: '', password: '', database: 'db' })).toHaveProperty('error')
    expect(buildDatabaseUrl({ host: 'h', port: '5432', user: 'u', password: '', database: '' })).toHaveProperty('error')
    expect(buildDatabaseUrl({ host: 'h/evil', port: '5432', user: 'u', password: '', database: 'db' })).toHaveProperty('error')
  })
})

describe('setup 端到端（pglite）', () => {
  it('needsSetup 时 status 报告全新安装，且守卫放行 /api/setup/*', async () => {
    delete process.env.DATABASE_URL
    const res = await req('/api/setup/status')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { needsSetup: boolean; needsBootstrap: boolean }
    expect(data.needsSetup).toBe(true)
    expect(data.needsBootstrap).toBe(true)
  })

  it('needsSetup 时其余业务路由仍被守卫拦截 503', async () => {
    delete process.env.DATABASE_URL
    const res = await req('/api/auth/bootstrap-admin')
    expect(res.status).toBe(503)
    const data = (await res.json()) as { needsSetup?: boolean }
    expect(data.needsSetup).toBe(true)
  })

  it('database 字段校验失败返回 400（不触发外连）', async () => {
    delete process.env.DATABASE_URL
    const res = await req('/api/setup/database', json('POST', { host: '', port: '5432', user: 'u', password: '', database: 'db' }))
    expect(res.status).toBe(400)
  })

  it('已配置时 database 返回 409（安装窗口关闭）', async () => {
    process.env.DATABASE_URL = 'postgres://test/test'
    const res = await req('/api/setup/database', json('POST', { host: 'h', port: '5432', user: 'u', password: 'p', database: 'db' }))
    expect(res.status).toBe(409)
  })

  it('配置后无管理员时 options 可写，status 报告 needsBootstrap', async () => {
    process.env.DATABASE_URL = 'postgres://test/test'
    const st = (await (await req('/api/setup/status')).json()) as { needsSetup: boolean; needsBootstrap: boolean }
    expect(st.needsSetup).toBe(false)
    expect(st.needsBootstrap).toBe(true)

    const res = await req('/api/setup/options', json('POST', { AI_TEXT_BASE_URL: 'https://ai.example.com/v1', HACK_KEY: 'x' }))
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; optionalKeys: string[] }
    expect(data.ok).toBe(true)
    expect(data.optionalKeys).toContain('AI_TEXT_BASE_URL')
    expect(data.optionalKeys).not.toContain('HACK_KEY')
  })

  it('管理员创建后 options 关闭 403（安装窗口结束）', async () => {
    process.env.DATABASE_URL = 'postgres://test/test'
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123' }))
    expect(boot.status).toBe(201)

    const res = await req('/api/setup/options', json('POST', { AI_TEXT_MODEL: 'x' }))
    expect(res.status).toBe(403)

    const st = (await (await req('/api/setup/status')).json()) as { needsBootstrap: boolean }
    expect(st.needsBootstrap).toBe(false)
  })

  it('数据库查询失败时 options 门禁 fail-closed 返回 503（不重开写入窗口）', async () => {
    process.env.DATABASE_URL = 'postgres://test/test'
    const broken = {
      query: async () => {
        throw new Error('connection refused')
      },
      async connect(): Promise<never> {
        throw new Error('connection refused')
      },
      async end() {},
    }
    setDbForTests(broken as unknown as Parameters<typeof setDbForTests>[0])
    try {
      const res = await req('/api/setup/options', json('POST', { AI_TEXT_MODEL: 'x' }))
      expect(res.status).toBe(503)
    } finally {
      setDbForTests(t.db)
    }
  })

  it('options 二次提交修正值与删除会同步 process.env', async () => {
    process.env.DATABASE_URL = 'postgres://test/test'
    // 无管理员的干净窗口：用独立 pglite 库（当前库已有 admin，重建一个）
    const t2 = await createTestDb()
    await t2.applyMigrations()
    setDbForTests(t2.db)
    delete process.env.AI_IMAGE_MODEL
    try {
      let res = await req('/api/setup/options', json('POST', { AI_IMAGE_MODEL: 'wrong' }))
      expect(res.status).toBe(200)
      expect(process.env.AI_IMAGE_MODEL).toBe('wrong')

      res = await req('/api/setup/options', json('POST', { AI_IMAGE_MODEL: 'right' }))
      expect(res.status).toBe(200)
      expect(process.env.AI_IMAGE_MODEL).toBe('right')

      res = await req('/api/setup/options', json('POST', { AI_IMAGE_MODEL: '' }))
      expect(res.status).toBe(200)
      expect(process.env.AI_IMAGE_MODEL).toBeUndefined()
    } finally {
      delete process.env.AI_IMAGE_MODEL
      setDbForTests(t.db)
      await t2.close()
    }
  })
})
