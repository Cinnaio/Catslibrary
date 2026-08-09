import { Pool, types } from 'pg'
import { loadConfig } from '../config'

/** 代码只依赖的最小 DB 接口；生产为 pg.Pool，测试可换 pglite 适配器。 */
export interface DbClient {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

export interface Db extends DbClient {
  connect(): Promise<{ query: DbClient['query']; release(): void }>
  end(): Promise<void>
}

// int8 → number。时间戳存 epoch 毫秒（< 2^53），node-postgres 默认把 int8
// 解析成字符串以防精度丢失，这里显式转回数字，与 D1 时代的 number 语义一致。
types.setTypeParser(20, (v) => Number(v))

let prodPool: Pool | null = null
let testOverride: Db | null = null

export class DbNotConfiguredError extends Error {
  constructor() {
    super('数据库未配置')
    this.name = 'DbNotConfiguredError'
  }
}

/** 测试注入点：将 getDb() 指向 pglite 适配器。 */
export function setDbForTests(db: Db | null): void {
  testOverride = db
}

/** 生产池；未配置 DATABASE_URL 时返回 null（API 进入 needsSetup 模式）。 */
export function getPool(): Pool | null {
  const config = loadConfig()
  if (!config.configured) return null
  if (prodPool) return prodPool
  prodPool = new Pool({
    connectionString: config.databaseUrl,
    max: 15,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5_000,
  })
  prodPool.on('error', (err) => {
    console.error('[db] idle client error:', (err as Error)?.message || err)
  })
  return prodPool
}

/** 获取 DB 执行器，未配置时抛错（由中间件捕获后返回 needsSetup）。 */
export function getDb(): Db {
  if (testOverride) return testOverride
  const p = getPool()
  if (!p) throw new DbNotConfiguredError()
  return p
}

/**
 * 重建连接池：/install 向导写入新 DATABASE_URL 后调用。
 * 旧池异步关闭（吞错），下次 getDb() 按当前配置懒建新池。
 */
export function resetPool(): void {
  const old = prodPool
  prodPool = null
  if (old) {
    old.end().catch((err) => {
      console.warn('[db] 旧连接池关闭失败（忽略）:', (err as Error)?.message || err)
    })
  }
}
