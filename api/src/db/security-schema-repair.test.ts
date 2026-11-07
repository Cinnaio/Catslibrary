import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFile(new URL(`./migrations/${name}.sql`, import.meta.url), 'utf8')

async function securityDb(legacy: boolean) {
  const db = new PGlite()
  await db.exec(await migration('072_security_center'))
  await db.exec(await migration('073_security_delivery_feedback'))
  if (legacy) {
    // Reproduce the live schema: 072 and 073 recorded, but three later-added
    // columns from 072 are absent. Only the isolated test database is altered.
    await db.exec(`ALTER TABLE security_events DROP COLUMN target_id;
      ALTER TABLE mail_jobs DROP COLUMN budget_at;
      ALTER TABLE mail_jobs DROP COLUMN had_unknown;`)
  }
  return db
}

async function seedLegacyJob(db: PGlite, id: string, state: string, attempts = 0) {
  await db.query(
    `INSERT INTO mail_jobs(id,user_id,actor_id,recipient_hash,recipient_hint,purpose,state,
    payload,token_hash,credential_hash,transport,transport_fingerprint,next_attempt_at,expires_at,created_at,updated_at,policy_revision,attempts)
    VALUES($1,'reader','reader','hash','a***@example.test','reset-password',$2,
    'encrypted-fixture','token-hash','credential-hash','smtp','transport-hash',1000,2000,1000,1500,0,$3)`,
    [id, state, attempts],
  )
}

describe('074 安全中心历史结构修复', () => {
  it('补齐已执行旧版 072 的字段，保留记录和预算并恢复事件查询', async () => {
    const db = await securityDb(true)
    try {
      await db.exec(`CREATE TABLE users(id text PRIMARY KEY, role text NOT NULL);
        INSERT INTO users VALUES('reader','reader');
        INSERT INTO security_events(id,bucket,action,rule,outcome,policy_revision,created_at,updated_at)
        VALUES('legacy-event','bucket','login','challenge','observed',0,1000,1000);
        INSERT INTO mail_budget VALUES('d:1970-01-01',6,6);`)
      await seedLegacyJob(db, 'queued', 'queued')
      await seedLegacyJob(db, 'unknown', 'unknown', 1)
      await seedLegacyJob(db, 'retry-unknown', 'queued', 1)
      await seedLegacyJob(db, 'retry-known', 'queued', 1)
      await seedLegacyJob(db, 'sending', 'sending', 1)
      await seedLegacyJob(db, 'missing-history', 'queued', 1)
      await db.exec(`INSERT INTO mail_attempts(job_id,attempt,outcome,created_at) VALUES
        ('retry-unknown',1,'unknown',1000),('retry-known',1,'retry',1000);`)

      await expect(db.query('SELECT e.target_id FROM security_events e')).rejects.toMatchObject({ code: '42703' })
      const repair = await migration('074_security_schema_repair')
      await db.exec(repair)
      await db.exec(repair)

      const query = `SELECT e.id,e.target_id,(e.source_hash<>'') AS can_restrict_source FROM security_events e
        WHERE ($1='' OR e.outcome=$1) AND ($2 OR EXISTS(SELECT 1 FROM users u WHERE u.id=e.target_id AND u.role='reader'))
        ORDER BY updated_at DESC,id LIMIT 30 OFFSET $3`
      expect((await db.query(query, ['', true, 0])).rows).toEqual([{ id: 'legacy-event', target_id: '', can_restrict_source: false }])
      expect((await db.query(query, ['', false, 0])).rows).toEqual([])
      const jobs = (
        await db.query<{ id: string; budget_at: number; had_unknown: boolean; payload: string }>(
          'SELECT id,budget_at,had_unknown,payload FROM mail_jobs ORDER BY id',
        )
      ).rows
      expect(jobs.map(({ id, had_unknown }) => [id, had_unknown])).toEqual([
        ['missing-history', true],
        ['queued', false],
        ['retry-known', false],
        ['retry-unknown', true],
        ['sending', true],
        ['unknown', true],
      ])
      expect(jobs.every((job) => Number(job.budget_at) === 1000 && job.payload === 'encrypted-fixture')).toBe(true)
      expect((await db.query('SELECT reserved,ordinary FROM mail_budget')).rows).toEqual([{ reserved: 6, ordinary: 6 }])
    } finally {
      await db.close()
    }
  })

  it('完整结构重复修复不覆盖事件归属、跨期预算时间或已有未知状态', async () => {
    const db = await securityDb(false)
    try {
      await db.exec(`INSERT INTO security_events(id,bucket,action,rule,outcome,target_id,policy_revision,created_at,updated_at)
        VALUES('current-event','bucket','login','challenge','observed','reader',0,1000,1000);
        INSERT INTO mail_jobs(id,user_id,actor_id,recipient_hash,recipient_hint,purpose,state,payload,token_hash,
          credential_hash,transport,transport_fingerprint,next_attempt_at,expires_at,created_at,updated_at,budget_at,policy_revision,had_unknown)
        VALUES('current-job','reader','reader','hash','a***@example.test','reset-password','queued','encrypted-fixture',
          'token-hash','credential-hash','smtp','transport-hash',1000,2000,1000,1500,1800,0,true);`)
      const before = (await db.query('SELECT * FROM mail_jobs')).rows
      const repair = await migration('074_security_schema_repair')
      await db.exec(repair)
      await db.exec(repair)
      expect((await db.query('SELECT * FROM mail_jobs')).rows).toEqual(before)
      expect((await db.query('SELECT target_id FROM security_events')).rows).toEqual([{ target_id: 'reader' }])
    } finally {
      await db.close()
    }
  })
})
