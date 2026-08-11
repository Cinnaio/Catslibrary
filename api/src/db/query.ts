import type { Db, DbClient } from './pool'

/** 单行查询，无结果返回 undefined。 */
export async function first<T>(db: Db, text: string, params: unknown[] = []): Promise<T | undefined> {
  const { rows } = await db.query<T>(text, params)
  return rows[0]
}

/** 多行查询。 */
export async function all<T>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query<T>(text, params)
  return rows
}

/** 写操作，返回受影响行数。 */
export async function run(db: Db, text: string, params: unknown[] = []): Promise<number> {
  const { rowCount } = await db.query(text, params)
  return rowCount ?? 0
}

/** 在单个事务内执行操作（替代原 D1 batch 的多语句原子性）。 */
export async function withTx<T>(db: Db, fn: (q: DbClient['query']) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // client.query 依赖 this 绑定，必须 bind，否则 pg 内部 this._Promise 为 undefined
    const result = await fn(client.query.bind(client))
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
