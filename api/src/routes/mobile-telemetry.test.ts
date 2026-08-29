import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

async function req(path: string, init?: RequestInit) {
  return app.request(path, init)
}

function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

async function jsonOf<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

describe('移动端匿名遥测', () => {
  let adminToken = ''

  it('接受受限事件、去重，并在后台展示', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'telemetry-admin', password: 'adminpass123' }))
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    const batch = {
      installId: 'install_telemetry_test_0001',
      sessionId: 'session_telemetry_test_0001',
      appVersion: '0.1.0',
      buildVersion: '8',
      osVersion: '26.0',
      deviceModel: 'iPhone Test',
      events: [
        {
          id: 'event_telemetry_test_0001',
          type: 'error',
          name: 'reader_load_failed',
          severity: 'error',
          properties: { context: 'reader', secret: { password: 'must-not-store' } },
          createdAt: Date.now(),
        },
        {
          id: 'event_telemetry_test_0002',
          type: 'diagnostic',
          name: 'metric_diagnostic',
          severity: 'info',
          properties: { diagnosticJSON: '{"application":"test"}' },
        },
      ],
    }
    const accepted = await req('/api/mobile/telemetry', json('POST', batch))
    expect(accepted.status).toBe(202)
    expect((await jsonOf<{ accepted: number }>(accepted)).accepted).toBe(2)

    const duplicate = await req('/api/mobile/telemetry', json('POST', batch))
    expect((await jsonOf<{ accepted: number }>(duplicate)).accepted).toBe(0)

    const list = await req('/api/admin/mobile-telemetry?type=error', json('GET', undefined, adminToken))
    expect(list.status).toBe(200)
    const data = await jsonOf<{
      events: Array<{ id: string; name: string; properties: string; deviceModel: string; status: string }>
      total: number
      summary: { errors: number; diagnostics: number; installs: number }
    }>(list)
    expect(data.total).toBe(1)
    const firstEvent = data.events[0]
    expect(firstEvent).toBeTruthy()
    expect(firstEvent?.name).toBe('reader_load_failed')
    expect(firstEvent?.deviceModel).toBe('iPhone Test')
    expect(firstEvent?.status).toBe('open')
    expect(firstEvent?.properties).not.toContain('must-not-store')
    expect(data.summary.errors).toBeGreaterThanOrEqual(1)
    expect(data.summary.diagnostics).toBeGreaterThanOrEqual(1)
    expect(data.summary.installs).toBe(1)

    const updated = await req('/api/admin/mobile-telemetry', json('PUT', {
      id: firstEvent?.id,
      status: 'resolved',
      adminNote: '已确认是测试事件',
    }, adminToken))
    expect(updated.status).toBe(200)
    const resolved = await req('/api/admin/mobile-telemetry?status=resolved', json('GET', undefined, adminToken))
    expect((await jsonOf<{ total: number }>(resolved)).total).toBe(1)
  })

  it('拒绝非法标识、非法事件和超大请求', async () => {
    const invalid = await req('/api/mobile/telemetry', json('POST', {
      installId: 'short',
      sessionId: 'session_telemetry_test_0001',
      events: [],
    }))
    expect(invalid.status).toBe(400)

    const badEvent = await req('/api/mobile/telemetry', json('POST', {
      installId: 'install_telemetry_test_0002',
      sessionId: 'session_telemetry_test_0002',
      events: [{ id: 'event_telemetry_test_0003', type: 'unknown', name: 'bad_event' }],
    }))
    expect(badEvent.status).toBe(400)

    const oversized = await req('/api/mobile/telemetry', json('POST', {
      installId: 'install_telemetry_test_0003',
      sessionId: 'session_telemetry_test_0003',
      events: [{
        id: 'event_telemetry_test_0004',
        type: 'diagnostic',
        name: 'metric_diagnostic',
        properties: { diagnosticJSON: 'x'.repeat(170 * 1024) },
      }],
    }))
    expect(oversized.status).toBe(413)
  })
})
