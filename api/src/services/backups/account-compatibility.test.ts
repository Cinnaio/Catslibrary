import { expect, it, vi } from 'vitest'
import type { Db } from '../../db/pool'
import type { Manifest } from './archive'
import { validateCompatibility } from './restore'

it('迁移前归档在执行恢复工具前提示明确的账号迁移步骤', async () => {
  const query = vi.fn(async () => ({ rows: [{ version: 70 }], rowCount: 1 }))
  const db = { query } as unknown as Db
  await expect(validateCompatibility(db, { migrationVersion: 69 } as Manifest)).rejects.toMatchObject({
    code: 'SUPER_ADMIN_MIGRATION_REQUIRED',
    message: expect.stringContaining('admin:recover'),
  })
  expect(query).toHaveBeenCalledTimes(1)
})
